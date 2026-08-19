"use server";

import { revalidatePath } from "next/cache";
import { and, eq, gt, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { ratingRoundRaters, ratingRounds, ratings } from "@/db/schema";
import { getCandidatosMvp, getCompanheiros } from "@/lib/ratings";
import { fecharSeTodosAvaliaram } from "@/lib/ratings-engine";
import { requirePlayer } from "@/lib/require-player";

export type AvaliarState = { error?: string; success?: boolean };

// O form fala meias-estrelas inteiras (1..10): 7 = 3,5★. Nenhum float
// atravessa o FormData — é o que evita a armadilha "3,5" vs "3.5" de locale.
const meiasSchema = z.coerce.number().int().min(1).max(10);

const mvpSchema = z.coerce.number().int().positive();

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
    return { error: "Não há companheiros para avaliar neste fut." };
  }

  // Só aceita o conjunto exato de companheiros: nota faltando é formulário
  // incompleto, e id estranho é gente que não jogou do lado dele.
  const notas: { ratedPlayerId: number; halfStars: number }[] = [];
  for (const companheiro of companheiros) {
    const parsed = meiasSchema.safeParse(formData.get(`estrelas-${companheiro.playerId}`));
    if (!parsed.success) {
      return { error: `Falta a nota de ${companheiro.nickname ?? companheiro.name}.` };
    }
    notas.push({ ratedPlayerId: companheiro.playerId, halfStars: parsed.data });
  }

  // O voto de melhor em campo faz parte do tudo-ou-nada: entre TODOS que
  // jogaram o fut e têm conta (os dois lados), menos o próprio. A lista é
  // refeita aqui pelo mesmo motivo das notas — Server Action é endpoint
  // público, e id estranho no form é gente que não jogou este fut.
  const candidatos = await getCandidatosMvp(rodada.matchDayId, session.player.id);
  let voto: number | null = null;
  if (candidatos.length > 0) {
    const parsed = mvpSchema.safeParse(formData.get("mvp"));
    if (!parsed.success) {
      return { error: "Falta escolher quem foi o melhor em campo." };
    }
    if (!candidatos.some((c) => c.playerId === parsed.data)) {
      return { error: "Esse jogador não jogou este fut." };
    }
    voto = parsed.data;
  }

  const fechouNoMeio = await db.transaction(async (tx) => {
    // Reconfere dentro da transação, travando a linha. Entre a checagem lá em
    // cima e este insert a rodada pode ter fechado — o admin clicando em
    // "Apurar agora" faz isso de forma determinística. Sem esta trava a nota
    // entraria numa rodada `closed`: fecharSeTodosAvaliaram não faria nada
    // agora, mas o replay lê todas as avaliações de todas as rodadas fechadas,
    // então ela seria absorvida silenciosamente no próximo recálculo, depois do
    // histórico daquela rodada já ter sido publicado.
    const [aberta] = await tx
      .select({ id: ratingRounds.id })
      .from(ratingRounds)
      .where(
        and(
          eq(ratingRounds.id, roundId),
          eq(ratingRounds.status, "open"),
          gt(ratingRounds.deadlineAt, sql`now()`),
        ),
      )
      .for("update");
    if (!aberta) return true;

    await tx
      .insert(ratings)
      .values(
        notas.map((n) => ({
          roundId,
          raterPlayerId: session.player.id,
          ratedPlayerId: n.ratedPlayerId,
          halfStars: n.halfStars,
        })),
      )
      // Reenviar antes do prazo sobrescreve — a unique do trio é o que permite.
      .onConflictDoUpdate({
        target: [ratings.roundId, ratings.raterPlayerId, ratings.ratedPlayerId],
        set: { halfStars: sql`excluded.half_stars`, updatedAt: new Date() },
      });

    // O voto vai no mesmo UPDATE da marca de conclusão: submitted_at continua
    // sendo o único "já enviou", e reenviar troca o voto junto com as notas.
    await tx
      .update(ratingRoundRaters)
      .set({ submittedAt: sql`now()`, mvpPlayerId: voto })
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

    return false;
  });

  if (fechouNoMeio) {
    return { error: "Esta avaliação não está mais aberta para você." };
  }

  // Se este era o último que faltava, a rodada fecha e as notas saem na hora —
  // ninguém precisa esperar as 36 horas. Uma falha AQUI não pode virar erro na
  // tela: as notas desta pessoa já commitaram, e o fechamento é idempotente —
  // o varredor de pendências fecha a rodada no prazo de qualquer jeito.
  try {
    await fecharSeTodosAvaliaram(roundId);
  } catch (erro) {
    console.error("[avaliar] falha ao fechar rodada após o último envio:", erro);
  }

  revalidatePath("/avaliar");
  revalidatePath(`/avaliar/${roundId}`);
  revalidatePath("/perfil");
  revalidatePath("/rankings");
  return { success: true };
}
