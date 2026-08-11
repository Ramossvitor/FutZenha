import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  invites,
  matchDayDeletionVotes,
  matchDays,
  players,
  ratingRounds,
  users,
} from "@/db/schema";

export type MetricasDaPlataforma = {
  jogadoresAtivos: number;
  contasAtivas: number;
  convitesPendentes: number;
  futsTotal: number;
  futsUltimos30Dias: number;
  organizadores: number;
  futsOrfaos: number;
  rodadasAbertas: number;
  votacoesAbertas: number;
};

/**
 * O painel de uso da plataforma. Uma ida ao banco por métrica, todas contagens
 * — o volume aqui é de dezenas de linhas, não de milhares.
 *
 * `organizadores` e `futsOrfaos` são as duas que interessam desde que
 * qualquer jogador cria fut: a primeira diz se a descentralização pegou, a
 * segunda conta os futs sem responsável (anteriores ao modelo, ou de criador
 * apagado), que só a plataforma consegue administrar.
 */
export async function getMetricas(): Promise<MetricasDaPlataforma> {
  const contar = async (query: Promise<{ total: number }[]>) => (await query)[0]?.total ?? 0;
  const total = sql<number>`count(*)::int`;

  const [
    jogadoresAtivos,
    contasAtivas,
    convitesPendentes,
    futsTotal,
    futsUltimos30Dias,
    organizadores,
    futsOrfaos,
    rodadasAbertas,
    votacoesAbertas,
  ] = await Promise.all([
    contar(db.select({ total }).from(players).where(eq(players.active, true))),
    contar(db.select({ total }).from(users).where(eq(users.active, true))),
    contar(
      db
        .select({ total })
        .from(invites)
        .where(sql`${invites.usedAt} is null and ${invites.expiresAt} > now()`),
    ),
    contar(db.select({ total }).from(matchDays)),
    contar(
      // Com janela dos dois lados: sem o limite superior todo fut futura —
      // e sempre há uma marcada, é o fluxo da home — entrava na conta de
      // "últimos 30 dias". `- 29` porque hoje conta como um dos trinta.
      db
        .select({ total })
        .from(matchDays)
        .where(sql`${matchDays.date} between current_date - 29 and current_date`),
    ),
    contar(
      db
        .select({ total: sql<number>`count(distinct ${matchDays.createdByPlayerId})::int` })
        .from(matchDays),
    ),
    contar(
      db
        .select({ total })
        .from(matchDays)
        .where(sql`${matchDays.createdByPlayerId} is null`),
    ),
    contar(db.select({ total }).from(ratingRounds).where(eq(ratingRounds.status, "open"))),
    contar(
      db.select({ total }).from(matchDayDeletionVotes).where(eq(matchDayDeletionVotes.status, "open")),
    ),
  ]);

  return {
    jogadoresAtivos,
    contasAtivas,
    convitesPendentes,
    futsTotal,
    futsUltimos30Dias,
    organizadores,
    futsOrfaos,
    rodadasAbertas,
    votacoesAbertas,
  };
}
