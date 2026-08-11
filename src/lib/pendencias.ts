import "server-only";
import { after } from "next/server";
import { and, eq, lte, notExists, sql } from "drizzle-orm";
import { db } from "@/db";
import { attendances, matchDays, players, ratingRounds, users } from "@/db/schema";
import { avisoDeVespera } from "./avisos-fut";
import { resolverVotacoesVencidas } from "./deletion";
import { condicaoElegivel } from "./elegiveis";
import { notificar } from "./notifications";
import { fecharRodada, LOCK_NOTA } from "./ratings-engine";
import { resolverDenunciasVencidas } from "./reports";

export type ResultadoVarredura = {
  rodadasFechadas: number;
  denunciasAceitas: number;
  votacoesResolvidas: number;
  // Candidatos varridos, não inserts: o dedupe (pelada:id:lembrete-vespera)
  // torna as passadas seguintes no-op, mas quem segue sem responder continua
  // contando até responder ou o dia virar.
  lembretesDeVespera: number;
};

/**
 * Aplica o que venceu por prazo: rodadas de avaliação com o prazo estourado
 * são fechadas e as notas recalculadas.
 *
 * O advisory lock é otimização, não garantia. Quem garante que nada acontece
 * duas vezes é cada transição ser `UPDATE ... WHERE status = 'open' RETURNING`
 * e o replay recalcular do zero em vez de aplicar delta.
 *
 * `pg_try_advisory_xact_lock`, e não `pg_advisory_lock`, por dois motivos: o
 * lock de transação solta sozinho no commit ou rollback, e é o único seguro
 * neste setup — a conexão é a string *pooled* do Neon (ver src/db/index.ts,
 * `prepare: false` por causa do PgBouncer em transaction mode), onde um lock
 * de sessão pode ficar preso numa conexão reciclada. O `try_` não bloqueia:
 * quem chega depois volta na hora, porque o trabalho é idempotente e será
 * retentado no próximo request.
 *
 * A chave é a mesma que `aplicarReplay` toma (LOCK_NOTA): a seção crítica que
 * os dois protegem é reescrever a nota. Reaver a chave lá dentro, já segurando
 * ela aqui, é no-op — advisory lock é reentrante na mesma transação.
 */
export async function processarPendencias(): Promise<ResultadoVarredura> {
  return db.transaction(async (tx) => {
    const travou = await tx.execute<{ locked: boolean }>(
      sql`select pg_try_advisory_xact_lock(${LOCK_NOTA}::bigint) as locked`,
    );
    if (!travou[0]?.locked) {
      return {
        rodadasFechadas: 0,
        denunciasAceitas: 0,
        votacoesResolvidas: 0,
        lembretesDeVespera: 0,
      };
    }

    const vencidas = await tx
      .select({ id: ratingRounds.id })
      .from(ratingRounds)
      .where(and(eq(ratingRounds.status, "open"), lte(ratingRounds.deadlineAt, sql`now()`)));

    let rodadasFechadas = 0;
    for (const rodada of vencidas) {
      if (await fecharRodada(tx, rodada.id, "prazo")) rodadasFechadas += 1;
    }

    // Depois das rodadas: o silêncio do admin no prazo vale como aceite, e
    // cada aceite descarta a nota e dispara o replay em cascata.
    const denunciasAceitas = await resolverDenunciasVencidas(tx);

    // Por último: uma votação aprovada apaga o fut inteiro, então rodar
    // depois evita fechar rodada de fut que vai deixar de existir.
    const votacoesResolvidas = await resolverVotacoesVencidas(tx);

    // Lembrete de véspera: fut agendada para AMANHÃ, para quem é elegível,
    // tem conta ativa e ainda não disse "vou" nem "fora". Mora na varredura, e
    // não numa action, porque não tem gesto de usuário para pegar carona — e o
    // cron garante a saída mesmo num dia sem tráfego. O fuso é explícito: o
    // piggyback roda a qualquer hora, e o `current_date` UTC viraria o dia às
    // 21h de Brasília — três horas avisando do fut errado.
    const futsDeAmanha = await tx
      .select()
      .from(matchDays)
      .where(
        and(
          eq(matchDays.status, "scheduled"),
          sql`${matchDays.date} = ((now() at time zone 'America/Sao_Paulo')::date + 1)`,
        ),
      );
    let lembretesDeVespera = 0;
    for (const fut of futsDeAmanha) {
      const semResposta = await tx
        .select({ id: players.id })
        .from(players)
        .innerJoin(users, and(eq(users.playerId, players.id), eq(users.active, true)))
        .where(
          and(
            eq(players.active, true),
            condicaoElegivel(fut),
            notExists(
              db
                .select({ um: sql`1` })
                .from(attendances)
                .where(
                  and(
                    eq(attendances.matchDayId, fut.id),
                    eq(attendances.playerId, players.id),
                  ),
                ),
            ),
          ),
        );
      await notificar(
        tx,
        semResposta.map((p) => avisoDeVespera(fut, p.id)),
      );
      lembretesDeVespera += semResposta.length;
    }

    return { rodadasFechadas, denunciasAceitas, votacoesResolvidas, lembretesDeVespera };
  });
}

// Throttle por instância: sem ele, todo pageview (inclusive prefetch e 404)
// abriria uma transação. O advisory lock cobre a corrida entre instâncias; os
// dois juntos bastam.
let ultimaExecucao = 0;
const INTERVALO_MS = 60_000;

/**
 * Agenda a varredura para depois da resposta. `after` vale em Server Component
 * e em Server Action, e roda mesmo quando a action termina em `redirect()`.
 *
 * O `.catch` é obrigatório: uma rejeição não tratada dentro do `after` derruba
 * o log da request inteira.
 */
export function agendarProcessamento(): void {
  const agora = Date.now();
  if (agora - ultimaExecucao < INTERVALO_MS) return;
  ultimaExecucao = agora;
  after(() => {
    processarPendencias().catch((erro) => {
      console.error("[pendencias] falha na varredura:", erro);
    });
  });
}
