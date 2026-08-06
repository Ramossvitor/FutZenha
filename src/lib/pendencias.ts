import "server-only";
import { after } from "next/server";
import { and, eq, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { ratingRounds } from "@/db/schema";
import { fecharRodada } from "./ratings-engine";

// Chave arbitrária, mas fixa: identifica o varredor de avaliações no Postgres.
// O cast para bigint acontece no SQL — o target do TS aqui não tem BigInt.
const LOCK_KEY = 918273645;

export type ResultadoVarredura = { rodadasFechadas: number };

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
 */
export async function processarPendencias(): Promise<ResultadoVarredura> {
  return db.transaction(async (tx) => {
    const travou = await tx.execute<{ locked: boolean }>(
      sql`select pg_try_advisory_xact_lock(${LOCK_KEY}::bigint) as locked`,
    );
    if (!travou[0]?.locked) return { rodadasFechadas: 0 };

    const vencidas = await tx
      .select({ id: ratingRounds.id })
      .from(ratingRounds)
      .where(and(eq(ratingRounds.status, "open"), lte(ratingRounds.deadlineAt, sql`now()`)));

    let rodadasFechadas = 0;
    for (const rodada of vencidas) {
      if (await fecharRodada(tx, rodada.id, "prazo")) rodadasFechadas += 1;
    }
    return { rodadasFechadas };
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
