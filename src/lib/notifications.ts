import "server-only";
import { cache } from "react";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, type Executor } from "@/db";
import {
  notifications,
  players,
  users,
  type Notification,
  type NotificationType,
} from "@/db/schema";

export type NovaNotificacao = {
  playerId: number;
  type: NotificationType;
  title: string;
  body?: string;
  href?: string;
  /**
   * Chave estável do evento que gerou a notificação — `rodada:12:aberta`,
   * `nota:rodada:12`, `nota:denuncia:7`. É o que torna notificar() idempotente:
   * reprocessar a mesma rodada não enche a caixa de entrada de duplicatas.
   */
  dedupeKey: string;
};

export async function notificar(exec: Executor, novas: NovaNotificacao[]): Promise<void> {
  if (novas.length === 0) return;
  await exec
    .insert(notifications)
    .values(novas)
    .onConflictDoNothing({ target: [notifications.playerId, notifications.dedupeKey] });
}

/** Uma linha reivindicada pelo despacho de push — ver reivindicarPendentesDePush. */
export type AvisoPendenteDePush = {
  id: number;
  playerId: number;
  title: string;
  body: string | null;
  href: string | null;
  createdAt: Date;
};

/**
 * Marca um lote de avisos como despachados e devolve as linhas — o claim do
 * outbox de push (src/lib/push-envio.ts), num comando só.
 *
 * Mora aqui, e não lá, porque `push_dispatched_at` é coluna de `notifications`:
 * quem escreve nesta tabela é este módulo, como em notificar(). O lock que
 * segura a corrida entre instâncias é do despachante — ele passa o `exec` da
 * transação já travada.
 */
export async function reivindicarPendentesDePush(
  exec: Executor,
  limite: number,
): Promise<AvisoPendenteDePush[]> {
  // Subconsulta (builder, não executada aqui) com order+limit: é o que dá um
  // lote determinístico e do tamanho pedido, igual ao `condicaoElegivel`.
  const lote = db
    .select({ id: notifications.id })
    .from(notifications)
    .where(isNull(notifications.pushDispatchedAt))
    .orderBy(asc(notifications.id))
    .limit(limite);

  return exec
    .update(notifications)
    .set({ pushDispatchedAt: sql`now()` })
    .where(inArray(notifications.id, lote))
    .returning({
      id: notifications.id,
      playerId: notifications.playerId,
      title: notifications.title,
      body: notifications.body,
      href: notifications.href,
      createdAt: notifications.createdAt,
    });
}

/** Uma linha reivindicada pelo despacho de e-mail — ver reivindicarPendentesDeEmail. */
export type AvisoPendenteDeEmail = {
  id: number;
  playerId: number;
  type: NotificationType;
  title: string;
  body: string | null;
  href: string | null;
  createdAt: Date;
};

/** Para onde mandar o aviso de um jogador — ver destinosDeEmail. */
export type DestinoDeAviso = {
  playerId: number;
  /** O nome de tratamento: apelido na frente, como no resumo do fut. */
  nome: string;
  /** `coalesce(users.email, users.contact_email)`, ou null se não há para onde mandar. */
  para: string | null;
  /** O toggle de /perfil. Só os avisáveis o respeitam — ver ./email-avisos. */
  avisosPorEmail: boolean;
};

/**
 * Marca um lote de avisos como despachados por e-mail e devolve as linhas — o
 * claim do outbox de e-mail (src/lib/email-avisos.ts), num comando só.
 *
 * Mora aqui pelo mesmo motivo do irmão de push: `email_dispatched_at` é coluna
 * de `notifications`, e quem escreve nesta tabela é este módulo. O lock que
 * segura a corrida entre instâncias é do despachante.
 *
 * **Reivindica TUDO que está pendente, inclusive o que não vai virar e-mail.**
 * Tipo fora da allowlist, jogador sem endereço, conta desativada, quem desligou
 * os avisos — todos saem marcados e nenhum deles é enviado. É deliberado: o
 * contrário deixaria a linha pendente para sempre, e cada varredura futura a
 * reexaminaria só para descartá-la de novo. Foi o bug que o `is not null` de
 * `retomarResumosPendentes` existe para evitar, e aqui ele seria eterno em vez
 * de durar 24h. Quem separa o que envia do que só marca é o despachante.
 *
 * Reivindicar tudo, porém, não quer dizer reivindicar em qualquer ordem: `comEmail`
 * é a allowlist do despachante, e ela vai para a FRENTE da fila. Sem isso, o
 * lote é `asc(id)` puro sobre uma fila em que 19 dos 26 tipos nunca viram
 * e-mail — e logo depois de um fut encerrar (~50 linhas de uma vez) o despacho
 * que `convidarParaOFut` força justamente para o convite sair agora drenava 30
 * linhas mudas e não alcançava o convite. A lista chega por parâmetro porque
 * quem sabe quais tipos viram e-mail é ./email-avisos, e este módulo importá-lo
 * fecharia um ciclo.
 */
export async function reivindicarPendentesDeEmail(
  exec: Executor,
  limite: number,
  comEmail: NotificationType[],
): Promise<AvisoPendenteDeEmail[]> {
  // Subconsulta (builder, não executada aqui) com order+limit, como no claim de
  // push: é o que dá um lote determinístico e do tamanho pedido. O desempate por
  // id mantém o determinismo dentro de cada um dos dois blocos.
  const lote = db
    .select({ id: notifications.id })
    .from(notifications)
    .where(isNull(notifications.emailDispatchedAt))
    .orderBy(desc(inArray(notifications.type, comEmail)), asc(notifications.id))
    .limit(limite);

  return exec
    .update(notifications)
    .set({ emailDispatchedAt: sql`now()` })
    .where(inArray(notifications.id, lote))
    .returning({
      id: notifications.id,
      playerId: notifications.playerId,
      type: notifications.type,
      title: notifications.title,
      body: notifications.body,
      href: notifications.href,
      createdAt: notifications.createdAt,
    });
}

/**
 * Para onde vão os e-mails destes jogadores.
 *
 * Separado do claim, e chamado FORA da transação dele — exatamente como o
 * despacho de push busca as assinaturas depois de reivindicar. Feita lá dentro,
 * esta leitura pediria uma segunda conexão do pool (max 5, ver src/db/index.ts)
 * enquanto a primeira está presa na transação: sob concorrência é assim que um
 * pool pequeno trava.
 *
 * O `left join` em users (e não `inner`) é deliberado: jogador sem conta nenhuma
 * — o convidado que ainda não resgatou o convite — precisa aparecer aqui, com
 * `para` nulo. Um inner join o sumiria do mapa, e o despachante trataria a
 * ausência como "sem endereço" de qualquer forma, mas por acidente em vez de
 * por desenho.
 */
export async function destinosDeEmail(playerIds: number[]): Promise<DestinoDeAviso[]> {
  if (playerIds.length === 0) return [];
  return db
    .select({
      playerId: players.id,
      nome: sql<string>`coalesce(${players.nickname}, ${players.name})`,
      // Conta desativada não recebe e-mail, pelo mesmo motivo que não recebe
      // push: o acesso acabou. O `case` devolve null em vez de filtrar a linha
      // fora — quem não recebe ainda precisa aparecer, para o despachante saber
      // que aquele aviso foi tratado.
      para: sql<
        string | null
      >`case when ${users.active} then coalesce(${users.email}, ${users.contactEmail}) else null end`,
      // Sem conta não há preferência: `false` mantém o aviso fora do envio, que
      // é o mesmo destino a que o `para` nulo já o levaria.
      avisosPorEmail: sql<boolean>`coalesce(${users.avisosPorEmail}, false)`,
    })
    .from(players)
    .leftJoin(users, eq(users.playerId, players.id))
    .where(inArray(players.id, [...new Set(playerIds)]));
}

// `cache()` porque o layout e /perfil contam no mesmo render.
export const contarNaoLidas = cache(async (playerId: number): Promise<number> => {
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.playerId, playerId), isNull(notifications.readAt)));
  return row?.total ?? 0;
});

export async function listarNotificacoes(playerId: number, limite = 50): Promise<Notification[]> {
  return db
    .select()
    .from(notifications)
    .where(eq(notifications.playerId, playerId))
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(limite);
}
