import "server-only";
import { and, asc, eq, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { matchDays, ratingReports, ratingRounds, ratings } from "@/db/schema";
import { notificar } from "./notifications";
import { aplicarReplay } from "./ratings-engine";
import { PRAZO_ADMIN_DIAS, prazoEmDias } from "./ratings";

type Executor = Pick<typeof db, "select" | "insert" | "update" | "delete">;

/**
 * Resolve uma denúncia e, se aceita, descarta a avaliação e recalcula tudo.
 *
 * `porAdmin = false` é o auto-aceite: o admin deixou o prazo vencer, e o
 * silêncio vale como aceite (decisão do produto — o jogador não pode ficar
 * refém da inércia de quem julga).
 *
 * A transição é `UPDATE ... WHERE status = 'open' RETURNING`: zero linhas
 * significa que outra execução já resolveu, e nada acontece de novo.
 */
export async function resolverDenuncia(
  exec: Executor,
  reportId: number,
  aceita: boolean,
  porAdmin: boolean,
  adminNote?: string,
): Promise<boolean> {
  const [resolvida] = await exec
    .update(ratingReports)
    .set({
      status: aceita ? "accepted" : "rejected",
      resolvedAt: sql`now()`,
      resolvedBy: porAdmin ? "admin" : "auto",
      adminNote: adminNote?.trim() || null,
    })
    .where(and(eq(ratingReports.id, reportId), eq(ratingReports.status, "open")))
    .returning({ ratingId: ratingReports.ratingId, reporterPlayerId: ratingReports.reporterPlayerId });

  if (!resolvida) return false;

  if (aceita) {
    // Descartar não apaga: a avaliação fica no banco marcada, e o replay
    // simplesmente deixa de contá-la.
    await exec
      .update(ratings)
      .set({ discardedAt: sql`now()` })
      .where(eq(ratings.id, resolvida.ratingId));

    await aplicarReplay(exec, { tipo: "revisao", dedupeKey: `nota:denuncia:${reportId}` });
  }

  await notificar(exec, [
    {
      playerId: resolvida.reporterPlayerId,
      type: "rating_report_resolved",
      title: aceita ? "Sua denúncia foi aceita" : "Sua denúncia foi recusada",
      body: aceita
        ? porAdmin
          ? "O admin descartou a nota, e as notas foram recalculadas."
          : "O admin não respondeu no prazo, então a nota foi descartada automaticamente."
        : "O admin analisou e considerou a nota justa. Ela continua valendo.",
      href: "/perfil",
      dedupeKey: `denuncia:${reportId}:resolvida`,
    },
  ]);

  return true;
}

/**
 * Auto-aceita as denúncias cujo prazo do admin venceu. Chamado pelo varredor.
 */
export async function resolverDenunciasVencidas(exec: Executor): Promise<number> {
  const vencidas = await exec
    .select({ id: ratingReports.id })
    .from(ratingReports)
    .where(and(eq(ratingReports.status, "open"), lte(ratingReports.adminDeadlineAt, sql`now()`)))
    .orderBy(asc(ratingReports.id));

  let aceitas = 0;
  for (const denuncia of vencidas) {
    if (await resolverDenuncia(exec, denuncia.id, true, false)) aceitas += 1;
  }
  return aceitas;
}

export type DenunciaNaFila = {
  reportId: number;
  ratingId: number;
  reason: string | null;
  reporterName: string;
  reporterPlayerId: number;
  roundId: number;
  matchDayId: number;
  matchDayDate: string;
  starsDenunciada: number;
  horasParaResponder: number;
};

/** Denúncias abertas, da mais urgente para a menos. */
export async function getDenunciasAbertas(): Promise<DenunciaNaFila[]> {
  const linhas = await db
    .select({
      reportId: ratingReports.id,
      ratingId: ratingReports.ratingId,
      reason: ratingReports.reason,
      reporterPlayerId: ratingReports.reporterPlayerId,
      roundId: ratingRounds.id,
      matchDayId: ratingRounds.matchDayId,
      matchDayDate: matchDays.date,
      starsDenunciada: ratings.stars,
      horasParaResponder: sql<number>`greatest(0, ceil(extract(epoch from (
        ${ratingReports.adminDeadlineAt} - now()
      )) / 3600)::int)`,
      reporterName: sql<string>`(select name from players where id = ${ratingReports.reporterPlayerId})`,
    })
    .from(ratingReports)
    .innerJoin(ratings, eq(ratingReports.ratingId, ratings.id))
    .innerJoin(ratingRounds, eq(ratings.roundId, ratingRounds.id))
    .innerJoin(matchDays, eq(ratingRounds.matchDayId, matchDays.id))
    .where(eq(ratingReports.status, "open"))
    .orderBy(asc(ratingReports.adminDeadlineAt));

  return linhas;
}

/** Todas as notas que o jogador recebeu na rodada, para o admin decidir com contexto. */
export async function getContextoDaDenuncia(roundId: number, playerId: number) {
  return db
    .select({
      ratingId: ratings.id,
      stars: ratings.stars,
      descartada: sql<boolean>`${ratings.discardedAt} is not null`,
    })
    .from(ratings)
    .where(and(eq(ratings.roundId, roundId), eq(ratings.ratedPlayerId, playerId)))
    .orderBy(asc(ratings.stars));
}

export const PRAZO_DENUNCIA_ADMIN_DIAS = PRAZO_ADMIN_DIAS;
export const prazoDoAdmin = () => prazoEmDias(PRAZO_ADMIN_DIAS);

/** Denúncias abertas cujo prazo ainda corre — usado no contador do painel. */
export async function contarDenunciasAbertas(): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(ratingReports)
    .where(and(eq(ratingReports.status, "open"), isNull(ratingReports.resolvedAt)));
  return row?.total ?? 0;
}
