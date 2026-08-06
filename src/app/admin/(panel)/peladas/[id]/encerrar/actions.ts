"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { attendances, gamePlayers, games, matchDays } from "@/db/schema";
import { abrirRodada } from "@/lib/ratings-engine";
import { requireAdmin } from "@/lib/require-admin";

// A escalação só é editável enquanto a pelada não foi encerrada. Depois da
// confirmação ela é imutável — é ela que define quem avalia quem, e mexer
// nela invalidaria avaliações já enviadas.
async function assertEditavel(matchDayId: number, gameId: number) {
  const [row] = await db
    .select({ status: matchDays.status })
    .from(games)
    .innerJoin(matchDays, eq(games.matchDayId, matchDays.id))
    .where(and(eq(games.id, gameId), eq(games.matchDayId, matchDayId)));

  if (!row) redirect(`/admin/peladas/${matchDayId}?erro=dados-invalidos`);
  if (row.status === "finished") {
    redirect(`/admin/peladas/${matchDayId}?erro=escalacao-travada`);
  }
}

function revalidar(matchDayId: number) {
  revalidatePath(`/admin/peladas/${matchDayId}/encerrar`);
  revalidatePath(`/admin/peladas/${matchDayId}`);
  revalidatePath(`/pelada/${matchDayId}`);
}

export async function moverLado(matchDayId: number, gameId: number, playerId: number) {
  await requireAdmin();
  await assertEditavel(matchDayId, gameId);

  await db
    .update(gamePlayers)
    .set({ side: sql`case when ${gamePlayers.side} = 'A' then 'B'::game_side else 'A'::game_side end` })
    .where(and(eq(gamePlayers.gameId, gameId), eq(gamePlayers.playerId, playerId)));
  revalidar(matchDayId);
}

// Tirar do jogo não tira a presença: dá para ter ido à pelada e não ter jogado
// aquela partida.
export async function removerDoJogo(matchDayId: number, gameId: number, playerId: number) {
  await requireAdmin();
  await assertEditavel(matchDayId, gameId);

  await db
    .delete(gamePlayers)
    .where(and(eq(gamePlayers.gameId, gameId), eq(gamePlayers.playerId, playerId)));
  revalidar(matchDayId);
}

// Escalar já marca a presença: quem apareceu na quadra sem confirmar é
// justamente o erro que esta tela existe para consertar.
export async function incluirNoJogo(
  matchDayId: number,
  gameId: number,
  side: "A" | "B",
  playerId: number,
) {
  await requireAdmin();
  await assertEditavel(matchDayId, gameId);

  await db.transaction(async (tx) => {
    await tx
      .insert(gamePlayers)
      .values({ gameId, playerId, side })
      .onConflictDoUpdate({
        target: [gamePlayers.gameId, gamePlayers.playerId],
        set: { side },
      });
    await tx
      .insert(attendances)
      .values({ matchDayId, playerId, status: "in" })
      .onConflictDoUpdate({
        target: [attendances.matchDayId, attendances.playerId],
        set: { status: "in", updatedAt: new Date() },
      });
  });
  revalidar(matchDayId);
}

export async function confirmarEncerramento(matchDayId: number) {
  await requireAdmin();

  const [matchDay] = await db.select().from(matchDays).where(eq(matchDays.id, matchDayId));
  if (!matchDay) redirect("/admin/peladas");
  if (matchDay.status === "finished") redirect(`/admin/peladas/${matchDayId}`);

  // Um jogo sem gente dos dois lados não tem placar que faça sentido, nem
  // companheiro para avaliar.
  const lados = await db
    .select({
      gameId: games.id,
      ladoA: sql<number>`count(*) filter (where ${gamePlayers.side} = 'A')::int`,
      ladoB: sql<number>`count(*) filter (where ${gamePlayers.side} = 'B')::int`,
    })
    .from(games)
    .leftJoin(gamePlayers, eq(gamePlayers.gameId, games.id))
    .where(eq(games.matchDayId, matchDayId))
    .groupBy(games.id);

  if (lados.some((l) => l.ladoA === 0 || l.ladoB === 0)) {
    redirect(`/admin/peladas/${matchDayId}/encerrar?erro=jogo-sem-time`);
  }

  await db
    .update(matchDays)
    .set({ status: "finished", finishedAt: sql`now()` })
    .where(eq(matchDays.id, matchDayId));

  // Encerrar com a escalação confirmada é o gatilho da avaliação.
  await abrirRodada(matchDayId);

  revalidatePath("/");
  revalidatePath("/peladas");
  revalidatePath("/artilharia");
  revalidatePath("/rankings");
  revalidar(matchDayId);
  redirect(`/admin/peladas/${matchDayId}`);
}
