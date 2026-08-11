import "server-only";
import { after } from "next/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import webpush from "web-push";
import { db } from "@/db";
import { pushSubscriptions, users } from "@/db/schema";
import { reivindicarPendentesDePush, type AvisoPendenteDePush } from "./notifications";

/**
 * Despacho de Web Push, com a tabela notifications como outbox.
 *
 * notificar() grava a intenção DENTRO da transação de quem notifica;
 * `push_dispatched_at` nasce null e é isso que enfileira. O despacho roda
 * depois da resposta (after) ou no cron, em duas fases:
 *
 *   1. claim, numa transação curta: marca um lote de pendentes como despachado
 *      e leva as linhas (UPDATE ... RETURNING, em notifications.ts). O advisory
 *      lock segura a corrida entre instâncias — quem não trava volta de mãos
 *      vazias, igual processarPendencias.
 *   2. envio, FORA de transação: fala com os push services. Rede nunca dentro
 *      de transação — a regra da casa desde o e-mail (email-convite.ts).
 *
 * Claim antes de enviar é at-most-once deliberado: um crash entre as fases
 * perde o push daquele lote, nunca duplica. A caixa de entrada in-app é a
 * fonte de verdade e continua lá; o push é aceleração, não garantia — a mesma
 * filosofia best-effort do email_sent_at.
 *
 * O que NÃO pode acontecer é o contrário: reivindicar o lote e descobrir só
 * depois que não dava para enviar. Por isso a config VAPID é validada antes do
 * claim (ver configurarVapid) e um 403 em rajada aborta a varredura em vez de
 * apagar assinatura.
 */

// Chave própria: a seção crítica é "quem despacha o lote", nada a ver com a
// reescrita de notas do LOCK_NOTA.
export const LOCK_PUSH = 274156039;

// Teto por varredura, não por minuto: um lote gigante só acontece em backlog
// anormal, e aí o cron seguinte continua de onde parou.
const LIMITE_POR_VARREDURA = 200;

// Quantos envios simultâneos. `Promise.all` no lote inteiro abria até
// LIMITE_POR_VARREDURA × devices conexões TLS de uma vez, e o claim já tinha
// marcado tudo: um timeout do runtime (maxDuration 60s) perdia o lote inteiro.
const CONCORRENCIA = 20;

// O push some do payload da notificação depois de 24h sem entrega — aviso de
// pelada velho de um dia é ruído, não informação.
const TTL_SEGUNDOS = 86_400;

// A mesma régua aplicada ANTES de enviar. O TTL só diz ao push service quanto
// tempo segurar para um device offline; não filtra linha velha na fila. Sem
// isto, ligar a chave VAPID pela primeira vez (ou religá-la) despejaria como
// novidade todo o backlog acumulado enquanto o kill switch esteve desligado.
const IDADE_MAXIMA_MS = TTL_SEGUNDOS * 1000;

// 403 é o push service dizendo que a assinatura NÃO foi feita com esta chave
// VAPID — quase sempre um par de chaves trocado no deploy, não um device morto.
// Nesse caso o 403 vem para todo endpoint, então apagar por 403 zeraria a
// tabela inteira. Poucas recusas: registra e segue. Muitas: para a varredura.
const LIMITE_DE_RECUSAS = 5;

export type ResultadoDespacho = {
  enviadas: number;
  falhas: number;
  assinaturasRemovidas: number;
  /** Reivindicadas mas velhas demais para virar push — ver IDADE_MAXIMA_MS. */
  ignoradasPorIdade: number;
  /** 403 do push service: chave VAPID errada, não device morto. */
  chavesRecusadas: number;
};

const nada = (extra: Partial<ResultadoDespacho> = {}): ResultadoDespacho => ({
  enviadas: 0,
  falhas: 0,
  assinaturasRemovidas: 0,
  ignoradasPorIdade: 0,
  chavesRecusadas: 0,
  ...extra,
});

/**
 * Sem as duas chaves VAPID, todo o push é no-op silencioso — o kill switch
 * padrão do projeto (emailConfigurado, CRON_SECRET): a UI se esconde e o
 * despacho volta zeros sem tocar o banco. Nos testes a ausência é obrigatória,
 * ver src/test/setup-integration.ts.
 */
export function pushConfigurado(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

/**
 * Instala as credenciais VAPID na lib. **Roda antes do claim, sempre.**
 *
 * `setVapidDetails` valida e LANÇA: chave que não decodifica em 65 bytes,
 * VAPID_SUBJECT que não é URL nem mailto (um `contato@dominio` sem o `mailto:`
 * basta). Como a config não muda entre invocações, chamar isto depois do claim
 * fazia cada varredura drenar 200 avisos da fila e não entregar nenhum — para
 * sempre, e em silêncio, porque o `after()` engole o erro no console.
 *
 * Devolve `false` em vez de propagar: config quebrada tem que virar no-op, o
 * mesmo destino de "sem chave nenhuma".
 */
function configurarVapid(): boolean {
  try {
    webpush.setVapidDetails(
      // Contato exigido pelo VAPID — é para onde o push service escreve se o
      // remetente se comportar mal. O default sai do domínio do projeto, como
      // o remetente do e-mail (README, passo 10).
      process.env.VAPID_SUBJECT ?? "mailto:contato@futzenha.com.br",
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
      process.env.VAPID_PRIVATE_KEY!,
    );
    return true;
  } catch (erro) {
    console.error(
      "[push] config VAPID inválida — despacho desligado até corrigir " +
        "(VAPID_SUBJECT precisa ser https:// ou mailto:):",
      erro,
    );
    return false;
  }
}

/**
 * Assinatura que nunca mais vai entregar: 404/410 é endpoint expirado ou
 * cancelado no aparelho. A linha vira lixo e o despacho a apaga — é a
 * auto-limpeza que dispensa qualquer rotina de manutenção.
 *
 * 403 ficou de fora de propósito: 404/410 são fatos sobre AQUELE device, 403 é
 * um fato sobre o remetente (par de chaves trocado). Ele chega igual para todo
 * endpoint, então tratá-lo como morte apagava a tabela inteira num deploy com
 * a chave errada — perda irreversível de um erro reversível de env var.
 */
export function assinaturaMorta(statusCode: number | undefined): boolean {
  return statusCode === 404 || statusCode === 410;
}

/** 403: a assinatura foi feita com outra chave VAPID. Problema de config. */
export function chaveRecusada(statusCode: number | undefined): boolean {
  return statusCode === 403;
}

// Teto do corpo na tela de bloqueio. O texto vem de campo livre do usuário
// (`location` da pelada), e o aviso de pelada avulsa vai para todo mundo: sem
// isto, qualquer jogador escreve o que quiser na notificação de todos. Quebra
// de linha some pelo mesmo motivo — no lock screen ela vira várias linhas.
const MAX_CORPO_PUSH = 120;

function corpoSeguro(body: string | null): string {
  if (!body) return "";
  const limpo = body
    .split("")
    .map((c) => (c < " " || c === "\u007F" ? " " : c))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  return limpo.length > MAX_CORPO_PUSH ? `${limpo.slice(0, MAX_CORPO_PUSH - 1)}…` : limpo;
}

/** Payload que o public/sw.js espera. Puro e exportado para o teste unit. */
export function payloadDePush(aviso: {
  title: string;
  body: string | null;
  href: string | null;
}): string {
  return JSON.stringify({
    title: aviso.title,
    body: corpoSeguro(aviso.body),
    href: aviso.href ?? "/",
  });
}

type Assinatura = typeof pushSubscriptions.$inferSelect;
type Envio = { aviso: AvisoPendenteDePush; assinatura: Assinatura };

export async function despacharPush(): Promise<ResultadoDespacho> {
  if (!pushConfigurado()) return nada();
  // ANTES do claim: config quebrada não pode consumir a fila. Ver configurarVapid.
  if (!configurarVapid()) return nada();

  // Fase 1 — claim. O UPDATE marca e leva num comando só; se duas instâncias
  // chegarem juntas, o lock manda a segunda embora sem trabalho.
  const reivindicadas = await db.transaction(async (tx) => {
    const travou = await tx.execute<{ locked: boolean }>(
      sql`select pg_try_advisory_xact_lock(${LOCK_PUSH}::bigint) as locked`,
    );
    if (!travou[0]?.locked) return [];
    return reivindicarPendentesDePush(tx, LIMITE_POR_VARREDURA);
  });
  if (reivindicadas.length === 0) return nada();

  // Marcadas (não voltam para a fila) mas velhas demais para virar push.
  const corte = Date.now() - IDADE_MAXIMA_MS;
  const pendentes = reivindicadas.filter((a) => a.createdAt.getTime() >= corte);
  const ignoradasPorIdade = reivindicadas.length - pendentes.length;
  if (pendentes.length === 0) return nada({ ignoradasPorIdade });

  // Fase 2 — envio, fora de transação. O join com users é o que impede push de
  // conta desativada: a assinatura sobrevive ao logout e à desativação, e sem
  // este filtro o device continuaria recebendo aviso de quem não tem mais acesso.
  const jogadores = [...new Set(pendentes.map((p) => p.playerId))];
  const assinaturas = await db
    .select({ assinatura: pushSubscriptions })
    .from(pushSubscriptions)
    .innerJoin(users, and(eq(users.playerId, pushSubscriptions.playerId), eq(users.active, true)))
    .where(inArray(pushSubscriptions.playerId, jogadores));
  if (assinaturas.length === 0) return nada({ ignoradasPorIdade });

  const porJogador = new Map<number, Assinatura[]>();
  for (const { assinatura } of assinaturas) {
    const lista = porJogador.get(assinatura.playerId) ?? [];
    lista.push(assinatura);
    porJogador.set(assinatura.playerId, lista);
  }

  const envios: Envio[] = pendentes.flatMap((aviso) =>
    (porJogador.get(aviso.playerId) ?? []).map((assinatura) => ({ aviso, assinatura })),
  );

  let enviadas = 0;
  let falhas = 0;
  let chavesRecusadas = 0;
  const mortas = new Set<string>();

  // Em blocos, não tudo de uma vez: ver CONCORRENCIA.
  for (let i = 0; i < envios.length; i += CONCORRENCIA) {
    await Promise.all(
      envios.slice(i, i + CONCORRENCIA).map(async ({ aviso, assinatura }) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: assinatura.endpoint,
              keys: { p256dh: assinatura.p256dh, auth: assinatura.auth },
            },
            payloadDePush(aviso),
            { TTL: TTL_SEGUNDOS },
          );
          enviadas += 1;
        } catch (erro) {
          const statusCode = (erro as { statusCode?: number }).statusCode;
          if (assinaturaMorta(statusCode)) {
            mortas.add(assinatura.endpoint);
          } else if (chaveRecusada(statusCode)) {
            chavesRecusadas += 1;
          } else {
            falhas += 1;
            console.error("[push] envio falhou:", { statusCode, aviso: aviso.id });
          }
        }
      }),
    );
    if (chavesRecusadas >= LIMITE_DE_RECUSAS) {
      console.error(
        `[push] ${chavesRecusadas} recusas 403 seguidas — o par de chaves VAPID ` +
          "provavelmente não é o que assinou estes devices. Varredura abortada; " +
          "nenhuma assinatura foi apagada.",
      );
      break;
    }
  }

  if (mortas.size > 0) {
    await db
      .delete(pushSubscriptions)
      .where(inArray(pushSubscriptions.endpoint, [...mortas]))
      .catch((erro) => {
        // Best-effort: a linha morta só custa um 410 na próxima varredura.
        console.error("[push] não limpou assinaturas mortas:", erro);
      });
  }

  return {
    enviadas,
    falhas,
    assinaturasRemovidas: mortas.size,
    ignoradasPorIdade,
    chavesRecusadas,
  };
}

// Throttle por instância, como agendarProcessamento: sem ele todo pageview
// abriria a transação do claim. O advisory lock cobre a corrida entre
// instâncias; os dois juntos bastam.
let ultimoDespacho = 0;
const INTERVALO_MS = 60_000;

/** Só para teste: zera o throttle por instância entre casos. */
export function reiniciarThrottleDePush(): void {
  ultimoDespacho = 0;
}

/**
 * Agenda o despacho para depois da resposta. `imediato` fura o throttle — é
 * para action que acabou de notificar algo sensível a tempo (vaga aberta,
 * pelada nova): o aviso sai nesta invocação, não na de daqui a um minuto.
 *
 * O callback async **retorna** a promessa ao after: é o que a entrega ao
 * waitUntil da Vercel — sem isso a invocação congela com o envio no ar (a
 * lição documentada em agendarAvisoDeConviteDeGrupo).
 */
export function agendarDespachoDePush(imediato = false): void {
  if (!pushConfigurado()) return;
  const agora = Date.now();
  if (!imediato && agora - ultimoDespacho < INTERVALO_MS) return;
  ultimoDespacho = agora;
  after(async () => {
    try {
      await despacharPush();
    } catch (erro) {
      console.error("[push] falha no despacho:", erro);
    }
  });
}
