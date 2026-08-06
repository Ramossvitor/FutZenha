"use server";

import { revalidatePath } from "next/cache";
import { and, eq, gt, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { ratingRoundRaters, ratingRounds, ratings } from "@/db/schema";
import { getCompanheiros } from "@/lib/ratings";
import { fecharSeTodosAvaliaram } from "@/lib/ratings-engine";
import { requirePlayer } from "@/lib/require-player";

export type AvaliarState = { error?: string; success?: boolean };

const estrelasSchema = z.coerce.number().int().min(1).max(5);

export async function enviarAvaliacoes(
  roundId: number,
  _prev: AvaliarState,
  formData: FormData,
): Promise<AvaliarState> {
  const session = await requirePlayer();

  // A rodada precisa estar aberta e dentro do prazo, e o jogador precisa ser
  // um dos avaliadores congelados na abertura. O prazo é comparado com o
  // now() do Postgres, nunca com o relógio do app.
  const [rodada] = await db
    .select({ matchDayId: ratingRounds.matchDayId })
    .from(ratingRoundRaters)
    .innerJoin(ratingRounds, eq(ratingRoundRaters.roundId, ratingRounds.id))
    .where(
      and(
        eq(ratingRoundRaters.roundId, roundId),
        eq(ratingRoundRaters.playerId, session.player.id),
        eq(ratingRounds.status, "open"),
        gt(ratingRounds.deadlineAt, sql`now()`),
      ),
    );
  if (!rodada) {
    return { error: "Esta avaliação não está mais aberta para você." };
  }

  const companheiros = await getCompanheiros(rodada.matchDayId, session.player.id);
  if (companheiros.length === 0) {
    return { error: "Não há companheiros para avaliar nesta pelada." };
  }

  // Só aceita o conjunto exato de companheiros: nota faltando é formulário
  // incompleto, e id estranho é gente que não jogou do lado dele.
  const notas: { ratedPlayerId: number; stars: number }[] = [];
  for (const companheiro of companheiros) {
    const parsed = estrelasSchema.safeParse(formData.get(`estrelas-${companheiro.playerId}`));
    if (!parsed.success) {
      return { error: `Falta a nota de ${companheiro.nickname ?? companheiro.name}.` };
    }
    notas.push({ ratedPlayerId: companheiro.playerId, stars: parsed.data });
  }

  await db.transaction(async (tx) => {
    await tx
      .insert(ratings)
      .values(
        notas.map((n) => ({
          roundId,
          raterPlayerId: session.player.id,
          ratedPlayerId: n.ratedPlayerId,
          stars: n.stars,
        })),
      )
      // Reenviar antes do prazo sobrescreve — a unique do trio é o que permite.
      .onConflictDoUpdate({
        target: [ratings.roundId, ratings.raterPlayerId, ratings.ratedPlayerId],
        set: { stars: sql`excluded.stars`, updatedAt: new Date() },
      });

    await tx
      .update(ratingRoundRaters)
      .set({ submittedAt: sql`now()` })
      .where(
        and(
          eq(ratingRoundRaters.roundId, roundId),
          eq(ratingRoundRaters.playerId, session.player.id),
        ),
      );

    // Limpa avaliações de companheiros que sumiram da lista entre um envio e
    // outro (uma conta desativada, por exemplo) — senão ficariam órfãs e
    // entrariam no cálculo.
    await tx
      .delete(ratings)
      .where(
        and(
          eq(ratings.roundId, roundId),
          eq(ratings.raterPlayerId, session.player.id),
          notInArray(
            ratings.ratedPlayerId,
            notas.map((n) => n.ratedPlayerId),
          ),
        ),
      );
  });

  // Se este era o último que faltava, a rodada fecha e as notas saem na hora —
  // ninguém precisa esperar os 2 dias.
  await fecharSeTodosAvaliaram(roundId);

  revalidatePath("/avaliar");
  revalidatePath(`/avaliar/${roundId}`);
  revalidatePath("/perfil");
  revalidatePath("/rankings");
  return { success: true };
}
