import "server-only";
import { db } from "@/db";
import { ratingRoundRaters, ratingRounds } from "@/db/schema";
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

// Não existe função para descartar rodada: a escalação é confirmada no
// encerramento e nunca mais muda, então a base da avaliação nunca fica
// inválida. O status `cancelled` fica reservado para a Fase 10, quando excluir
// a pelada por votação também apaga a rodada dela.
