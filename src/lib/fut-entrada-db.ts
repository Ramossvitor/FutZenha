import "server-only";
import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, isNull, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, type Executor } from "@/db";
import {
  attendances,
  matchDayInviteLinks,
  matchDayInvitations,
  matchDayJoinRequests,
  matchDays,
  players,
  users,
} from "@/db/schema";
import { VALIDADE_CONVITE_MS } from "./regras";
import { siteUrl } from "./site-url";

// Os fatos que as regras de ./fut-entrada consomem, e as escritas dos três
// caminhos de entrada. Sem guard: quem autoriza é a action, como em
// ./convites e ./grupos.

/** Estas duas pessoas já dividiram um fut? É o vínculo do fut avulso. */
export async function jaJogaramJuntos(a: number, b: number): Promise<boolean> {
  const minhas = alias(attendances, "minhas");
  const [linha] = await db
    .select({ um: sql`1` })
    .from(attendances)
    .innerJoin(minhas, eq(minhas.matchDayId, attendances.matchDayId))
    .where(and(eq(attendances.playerId, a), eq(minhas.playerId, b)))
    .limit(1);
  return linha !== undefined;
}

/**
 * Esta pessoa é do círculo deste fut avulso?
 *
 * Círculo = quem organiza, ou quem já dividiu um fut com quem organiza. É o
 * mesmo conjunto que `condicaoDeAviso` (src/lib/elegiveis.ts) notifica, e essa
 * simetria é intencional: quem é avisado de um fut consegue entrar nele, e quem
 * não é, pede.
 *
 * Fut ÓRFÃO devolve `true`. Não é indulgência: sem criador não há lista de
 * ninguém a proteger, e recusar deixaria fut antigo (a FK é `set null`)
 * inalcançável para todo mundo — quebrando o que sempre funcionou por uma regra
 * que ali não tem sujeito.
 */
export async function estaNoCirculoDoFut(
  fut: { createdByPlayerId: number | null },
  playerId: number,
): Promise<boolean> {
  if (fut.createdByPlayerId === null) return true;
  if (fut.createdByPlayerId === playerId) return true;
  return jaJogaramJuntos(fut.createdByPlayerId, playerId);
}

export async function estaNaLista(matchDayId: number, playerId: number): Promise<boolean> {
  const [linha] = await db
    .select({ um: sql`1` })
    .from(attendances)
    .where(and(eq(attendances.matchDayId, matchDayId), eq(attendances.playerId, playerId)));
  return linha !== undefined;
}

export async function temPedidoPendenteNoFut(
  matchDayId: number,
  playerId: number,
): Promise<boolean> {
  const [linha] = await db
    .select({ id: matchDayJoinRequests.id })
    .from(matchDayJoinRequests)
    .where(
      and(
        eq(matchDayJoinRequests.matchDayId, matchDayId),
        eq(matchDayJoinRequests.playerId, playerId),
        eq(matchDayJoinRequests.status, "pending"),
      ),
    );
  return linha !== undefined;
}

/**
 * Fecha o pedido pendente de quem entrou por outro caminho.
 *
 * Os três caminhos chamam isto pelo mesmo motivo de `fecharPedidoPendente` nos
 * grupos: sem ele, quem pediu e entrou por fora fica para sempre na fila de
 * quem organiza — e, como o índice é parcial em `pending`, a linha esquecida
 * ainda bloquearia um pedido legítimo se a pessoa saísse e quisesse voltar.
 */
export async function fecharPedidoDeFut(
  exec: Executor,
  matchDayId: number,
  playerId: number,
): Promise<void> {
  await exec
    .update(matchDayJoinRequests)
    .set({ status: "approved", decidedAt: new Date() })
    .where(
      and(
        eq(matchDayJoinRequests.matchDayId, matchDayId),
        eq(matchDayJoinRequests.playerId, playerId),
        eq(matchDayJoinRequests.status, "pending"),
      ),
    );
}

/** Idem para o convite: quem entrou não precisa mais responder. */
export async function fecharConvitePendente(
  exec: Executor,
  matchDayId: number,
  playerId: number,
): Promise<void> {
  await exec
    .update(matchDayInvitations)
    .set({ status: "accepted", respondedAt: new Date() })
    .where(
      and(
        eq(matchDayInvitations.matchDayId, matchDayId),
        eq(matchDayInvitations.playerId, playerId),
        eq(matchDayInvitations.status, "pending"),
      ),
    );
}

// ---------------------------------------------------------------------------
// Leituras de tela
// ---------------------------------------------------------------------------

/** Convites de fut pendentes para mim — a caixa de entrada de /futs. */
export async function convitesDeFutPendentes(playerId: number) {
  return db
    .select({
      id: matchDayInvitations.id,
      matchDayId: matchDays.id,
      date: matchDays.date,
      startTime: matchDays.startTime,
      endTime: matchDays.endTime,
      location: matchDays.location,
      convidadoPor: players.name,
    })
    .from(matchDayInvitations)
    .innerJoin(matchDays, eq(matchDayInvitations.matchDayId, matchDays.id))
    .leftJoin(players, eq(matchDayInvitations.invitedByPlayerId, players.id))
    .where(
      and(
        eq(matchDayInvitations.playerId, playerId),
        eq(matchDayInvitations.status, "pending"),
        // Convite de fut que já sorteou os times não é respondível — some da
        // caixa em vez de virar um botão que a action recusa.
        eq(matchDays.status, "scheduled"),
      ),
    )
    .orderBy(asc(matchDays.date));
}

/** A fila de pedidos deste fut, para quem organiza. */
export async function pedidosDeEntradaPendentes(matchDayId: number) {
  return db
    .select({
      id: matchDayJoinRequests.id,
      playerId: players.id,
      name: players.name,
      nickname: players.nickname,
      skill: players.skill,
      isGoalkeeper: players.isGoalkeeper,
      createdAt: matchDayJoinRequests.createdAt,
    })
    .from(matchDayJoinRequests)
    .innerJoin(players, eq(matchDayJoinRequests.playerId, players.id))
    .where(
      and(
        eq(matchDayJoinRequests.matchDayId, matchDayId),
        eq(matchDayJoinRequests.status, "pending"),
      ),
    )
    .orderBy(asc(matchDayJoinRequests.createdAt));
}

/** Convites nominais que este fut já mandou e ainda aguardam resposta. */
export async function convitesDeFutEnviados(matchDayId: number) {
  return db
    .select({
      id: matchDayInvitations.id,
      playerId: players.id,
      name: players.name,
      nickname: players.nickname,
      createdAt: matchDayInvitations.createdAt,
    })
    .from(matchDayInvitations)
    .innerJoin(players, eq(matchDayInvitations.playerId, players.id))
    .where(
      and(
        eq(matchDayInvitations.matchDayId, matchDayId),
        eq(matchDayInvitations.status, "pending"),
      ),
    )
    .orderBy(desc(matchDayInvitations.createdAt));
}

/**
 * Os futs avulsos abertos que qualquer pessoa logada pode encontrar — a aba de
 * explorar.
 *
 * Só **avulso**: fut de grupo é do grupo, e listá-lo aqui entregaria a
 * existência (data, local e nome do organizador) de fut de grupo privado para
 * quem não é membro — exatamente o que o 404 de `require-grupo.ts` esconde.
 *
 * Só **`scheduled`**: depois do sorteio não se entra por conta própria.
 *
 * E só o que a pessoa PODE explorar: fut que ela organiza, ou em que já tem
 * linha na lista, fica de fora. Não é filtro de segurança — é o que impede a
 * aba de repetir, logo abaixo, o mesmo fut que a lista principal acabou de
 * mostrar. "Explorar" é o que dá para entrar, não um segundo índice de tudo.
 */
export async function futsParaExplorar(playerId: number, limite = 30) {
  const jaEstou = alias(attendances, "ja_estou");
  const meuPedido = alias(matchDayJoinRequests, "meu_pedido");
  return db
    .select({
      id: matchDays.id,
      date: matchDays.date,
      startTime: matchDays.startTime,
      endTime: matchDays.endTime,
      location: matchDays.location,
      maxPlayers: matchDays.maxPlayers,
      organizador: players.name,
      confirmados: sql<number>`(
        select count(*)::int from attendances a
         where a.match_day_id = ${matchDays.id} and a.status = 'in'
      )`,
      jaPedi: sql<boolean>`${meuPedido.id} is not null`,
    })
    .from(matchDays)
    .leftJoin(players, eq(matchDays.createdByPlayerId, players.id))
    .leftJoin(
      jaEstou,
      and(eq(jaEstou.matchDayId, matchDays.id), eq(jaEstou.playerId, playerId)),
    )
    .leftJoin(
      meuPedido,
      and(
        eq(meuPedido.matchDayId, matchDays.id),
        eq(meuPedido.playerId, playerId),
        eq(meuPedido.status, "pending"),
      ),
    )
    .where(
      and(
        isNull(matchDays.groupId),
        eq(matchDays.status, "scheduled"),
        // Nem o que eu organizo, nem o que eu já entrei: os dois já aparecem na
        // lista principal desta mesma tela.
        isNull(jaEstou.playerId),
        or(
          isNull(matchDays.createdByPlayerId),
          ne(matchDays.createdByPlayerId, playerId),
        ),
        // Fut de hoje em diante. `date` é `date` puro, então a comparação é com
        // o dia de Brasília — o mesmo fuso explícito do lembrete de véspera.
        sql`${matchDays.date} >= (now() at time zone 'America/Sao_Paulo')::date`,
      ),
    )
    .orderBy(asc(matchDays.date), asc(matchDays.id))
    .limit(limite);
}

// ---------------------------------------------------------------------------
// Link
// ---------------------------------------------------------------------------

/**
 * Gera o link do fut e revoga os ativos, no mesmo executor — espelho de
 * `gerarLink` dos grupos, e pelo mesmo motivo: sem revogar os anteriores,
 * "revogar o link" não significaria nada.
 */
export async function gerarLinkDoFut(
  exec: Executor,
  matchDayId: number,
  createdByPlayerId: number,
  maxUses: number | null,
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await exec
    .update(matchDayInviteLinks)
    .set({ revokedAt: new Date() })
    .where(
      and(eq(matchDayInviteLinks.matchDayId, matchDayId), isNull(matchDayInviteLinks.revokedAt)),
    );
  await exec.insert(matchDayInviteLinks).values({
    matchDayId,
    token,
    createdByPlayerId,
    maxUses,
    expiresAt: new Date(Date.now() + VALIDADE_CONVITE_MS),
  });
  return token;
}

/** O link vivo do fut, se houver. */
export async function linkAtivoDoFut(matchDayId: number) {
  const [link] = await db
    .select()
    .from(matchDayInviteLinks)
    .where(
      and(
        eq(matchDayInviteLinks.matchDayId, matchDayId),
        condicaoLinkVivoDoFut(sql`now()`),
      ),
    )
    .orderBy(desc(matchDayInviteLinks.createdAt))
    // `gerarLinkDoFut` revoga os anteriores, então na prática é sempre um só —
    // mas carregar N linhas para usar a primeira é caro à toa, e o dia em que
    // sobrarem dois vivos é justamente o dia em que isso importa.
    .limit(1);
  return link;
}

/**
 * A mesma forma de `condicaoLinkVivo` (./grupos-link), sobre a tabela do fut.
 *
 * É cópia da FORMA, não da regra: aquela função amarra colunas de
 * `group_invite_links` e não dá para reapontá-la sem genéricos que tornariam as
 * duas ilegíveis. O que não pode divergir é o significado — não revogado,
 * dentro da validade, com uso sobrando —, e é por isso que os dois testes
 * cobrem as mesmas três bordas.
 */
export function condicaoLinkVivoDoFut(agora: ReturnType<typeof sql>) {
  return and(
    isNull(matchDayInviteLinks.revokedAt),
    sql`${matchDayInviteLinks.expiresAt} > ${agora}`,
    or(
      isNull(matchDayInviteLinks.maxUses),
      sql`${matchDayInviteLinks.usesCount} < ${matchDayInviteLinks.maxUses}`,
    ),
  );
}

/** A URL que vai no WhatsApp. */
export function urlDoLinkDoFut(token: string): string {
  return `${siteUrl()}/convite-fut/${token}`;
}

/** Quem tem conta ativa? O convite nominal só alcança quem pode responder. */
export async function temContaAtiva(playerId: number): Promise<boolean> {
  const [linha] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.playerId, playerId), eq(users.active, true)));
  return linha !== undefined;
}
