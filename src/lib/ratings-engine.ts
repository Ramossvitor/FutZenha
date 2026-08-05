import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { notifications, ratingRoundRaters, ratingRounds } from "@/db/schema";
import { notificar } from "./notifications";
import { getRatersElegiveis, PRAZO_AVALIACAO_DIAS, prazoEmDias } from "./ratings";

/**
 * Abre a rodada de avaliação de uma pelada encerrada.
 *
 * Idempotente por construção: a unique em `rating_rounds.match_day_id` mais o
 * `onConflictDoNothing` garantem que encerrar a mesma pelada duas vezes não
 * abre duas rodadas nem notifica de novo.
 *
 * Devolve o id da rodada criada, ou null quando não há o que avaliar — pelada
 * sem jogos lançados, sem escalação, ou sem ninguém com conta ativa. Nesses
 * casos a pelada encerra normalmente, só não gera avaliação.
 */
export async function abrirRodada(matchDayId: number): Promise<number | null> {
  const raters = await getRatersElegiveis(matchDayId);
  if (raters.length === 0) return null;

  return db.transaction(async (tx) => {
    const [round] = await tx
      .insert(ratingRounds)
      .values({ matchDayId, deadlineAt: prazoEmDias(PRAZO_AVALIACAO_DIAS) })
      .onConflictDoNothing({ target: ratingRounds.matchDayId })
      .returning();
    // Já existia uma rodada para esta pelada — nada a fazer.
    if (!round) return null;

    await tx.insert(ratingRoundRaters).values(
      raters.map((r) => ({ roundId: round.id, playerId: r.playerId, userId: r.userId })),
    );

    await notificar(
      tx,
      raters.map((r) => ({
        playerId: r.playerId,
        type: "rating_round_open" as const,
        title: "Avalie seus companheiros",
        body: `Você tem ${PRAZO_AVALIACAO_DIAS} dias para avaliar quem jogou com você.`,
        href: `/avaliar/${round.id}`,
        dedupeKey: `rodada:${round.id}:aberta`,
      })),
    );

    return round.id;
  });
}

/**
 * Descarta a rodada em andamento de uma pelada. Usado quando o admin reabre a
 * pelada: os jogos voltam a ser editáveis e é a escalação deles que define quem
 * avalia quem, então a rodada não pode continuar de pé.
 *
 * Apaga em vez de marcar como cancelada, por dois motivos. Uma rodada aberta
 * ainda não produziu nada — nenhuma nota mudou, nenhuma linha de histórico
 * existe —, então ela literalmente não aconteceu. E a unique em `match_day_id`
 * é o que garante uma rodada por pelada: deixar a cancelada ocupando a vaga
 * impediria a pelada de abrir rodada nova ao ser encerrada de novo.
 *
 * O status `cancelled` fica reservado para rodada já apurada, onde as
 * avaliações precisam sobreviver para o replay saber o que ignorar.
 *
 * Efeito colateral assumido: as avaliações já enviadas nessa rodada somem junto
 * (cascade) e quem avaliou vai precisar avaliar de novo.
 */
export async function descartarRodadaAberta(matchDayId: number): Promise<boolean> {
  const [round] = await db
    .select({ id: ratingRounds.id })
    .from(ratingRounds)
    .where(and(eq(ratingRounds.matchDayId, matchDayId), eq(ratingRounds.status, "open")));
  if (!round) return false;

  await db.transaction(async (tx) => {
    // Avaliações e avaliadores caem por cascade; a notificação não, porque
    // aponta para o jogador — e ficaria apontando para uma rodada inexistente.
    await tx.delete(notifications).where(eq(notifications.dedupeKey, `rodada:${round.id}:aberta`));
    await tx.delete(ratingRounds).where(eq(ratingRounds.id, round.id));
  });
  return true;
}
