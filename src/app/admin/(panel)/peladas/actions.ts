"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  attendances,
  gamePlayers,
  games,
  goals,
  matchDays,
  players,
  teamPlayers,
  teams,
} from "@/db/schema";
import { abrirVotacao } from "@/lib/deletion";
import { drawTeams } from "@/lib/draw";
import { requireAdmin } from "@/lib/require-admin";
import { defaultTeamNames } from "@/lib/team-colors";

const matchDaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida"),
  startTime: z
    .string()
    .transform((v) => (v === "" ? null : v)),
  location: z.string().trim().min(1, "Local é obrigatório").max(120),
  notes: z
    .string()
    .trim()
    .max(500)
    .transform((v) => (v === "" ? null : v)),
});

function parseMatchDayForm(formData: FormData) {
  return matchDaySchema.safeParse({
    date: formData.get("date") ?? "",
    startTime: formData.get("startTime") ?? "",
    location: formData.get("location") ?? "",
    notes: formData.get("notes") ?? "",
  });
}

export async function createMatchDay(formData: FormData) {
  await requireAdmin();
  const parsed = parseMatchDayForm(formData);
  if (!parsed.success) redirect("/admin/peladas?erro=dados-invalidos");

  const [created] = await db.insert(matchDays).values(parsed.data).returning();
  revalidatePath("/");
  revalidatePath("/admin/peladas");
  redirect(`/admin/peladas/${created.id}`);
}

export async function updateMatchDay(matchDayId: number, formData: FormData) {
  await requireAdmin();
  const parsed = parseMatchDayForm(formData);
  if (!parsed.success) redirect(`/admin/peladas/${matchDayId}?erro=dados-invalidos`);

  await db.update(matchDays).set(parsed.data).where(eq(matchDays.id, matchDayId));
  revalidatePath("/");
  revalidatePath(`/admin/peladas/${matchDayId}`);
  revalidatePath(`/pelada/${matchDayId}`);
}

/**
 * Apaga a pelada. Só vale para pelada não encerrada — nela não há gol, V/E/D
 * nem avaliação de ninguém em jogo. Encerrada, quem decide é quem jogou, pela
 * votação (ver abrirVotacaoExclusao).
 */
export async function deleteMatchDay(matchDayId: number) {
  await requireAdmin();
  const [matchDay] = await db.select().from(matchDays).where(eq(matchDays.id, matchDayId));
  if (!matchDay) redirect("/admin/peladas");
  if (matchDay.status === "finished") {
    redirect(`/admin/peladas/${matchDayId}?erro=precisa-votacao`);
  }

  await db.delete(matchDays).where(eq(matchDays.id, matchDayId));
  revalidatePath("/");
  revalidatePath("/admin/peladas");
  redirect("/admin/peladas");
}

const motivoSchema = z.string().trim().min(10, "Explique o motivo").max(500);

/**
 * Abre a votação para apagar uma pelada encerrada. Sem ninguém com conta que
 * tenha jogado, não há quem seja afetado — aí o admin apaga direto.
 */
export async function abrirVotacaoExclusao(matchDayId: number, formData: FormData) {
  await requireAdmin();
  const parsed = motivoSchema.safeParse(formData.get("reason") ?? "");
  if (!parsed.success) redirect(`/admin/peladas/${matchDayId}?erro=motivo-curto`);

  const [matchDay] = await db.select().from(matchDays).where(eq(matchDays.id, matchDayId));
  if (!matchDay || matchDay.status !== "finished") {
    redirect(`/admin/peladas/${matchDayId}?erro=dados-invalidos`);
  }

  const resultado = await abrirVotacao(matchDayId, parsed.data);
  if (resultado.tipo === "sem-eleitores") {
    await db.delete(matchDays).where(eq(matchDays.id, matchDayId));
    revalidatePath("/");
    revalidatePath("/admin/peladas");
    revalidatePath("/rankings");
    redirect("/admin/peladas?erro=excluida-sem-votacao");
  }

  revalidateMatchDay(matchDayId);
  redirect(`/admin/peladas/${matchDayId}`);
}

// A escalação (times, jogos, quem jogou) é imutável depois do encerramento —
// é ela que define quem avalia quem, e mexer nela invalidaria avaliações já
// enviadas. Corrigir escalação errada só excluindo a pelada.
async function assertEscalacaoEditavel(matchDayId: number) {
  const [matchDay] = await db.select().from(matchDays).where(eq(matchDays.id, matchDayId));
  if (!matchDay) redirect("/admin/peladas");
  if (matchDay.status === "finished") {
    redirect(`/admin/peladas/${matchDayId}?erro=escalacao-travada`);
  }
  return matchDay;
}

// Placar e gols não mexem em quem avalia quem, então ganham uma janela de 24h
// depois do encerramento. `finished_at` nulo numa pelada encerrada conta como
// fora da janela: sem marco temporal não há o que liberar.
const JANELA_CORRECAO = sql`
  ${matchDays.status} <> 'finished'
  or (${matchDays.finishedAt} is not null and ${matchDays.finishedAt} + interval '24 hours' > now())
`;

async function assertPlacarEditavel(matchDayId: number) {
  const [row] = await db
    .select({ dentroDaJanela: sql<boolean>`${JANELA_CORRECAO}` })
    .from(matchDays)
    .where(eq(matchDays.id, matchDayId));
  if (!row) redirect("/admin/peladas");
  if (!row.dentroDaJanela) {
    redirect(`/admin/peladas/${matchDayId}?erro=janela-encerrada`);
  }
}

function revalidateMatchDay(matchDayId: number) {
  revalidatePath("/");
  revalidatePath("/peladas");
  revalidatePath(`/admin/peladas/${matchDayId}`);
  revalidatePath(`/pelada/${matchDayId}`);
}

export async function drawTeamsAction(matchDayId: number, formData: FormData) {
  await requireAdmin();
  const teamCount = Number(formData.get("teamCount"));
  if (!Number.isInteger(teamCount) || teamCount < 2 || teamCount > 6) {
    redirect(`/admin/peladas/${matchDayId}?erro=dados-invalidos`);
  }

  await assertEscalacaoEditavel(matchDayId);

  // Re-sortear apagaria os jogos por cascade — exige apagar os jogos antes.
  const existingGames = await db.select().from(games).where(eq(games.matchDayId, matchDayId));
  if (existingGames.length > 0) {
    redirect(`/admin/peladas/${matchDayId}?erro=jogos-lancados`);
  }

  const confirmed = await db
    .select({
      id: players.id,
      name: players.name,
      skill: players.skill,
      isGoalkeeper: players.isGoalkeeper,
    })
    .from(attendances)
    .innerJoin(players, eq(attendances.playerId, players.id))
    .where(and(eq(attendances.matchDayId, matchDayId), eq(attendances.status, "in")));

  if (confirmed.length < teamCount) {
    redirect(`/admin/peladas/${matchDayId}?erro=poucos-jogadores`);
  }

  const drawn = drawTeams(confirmed, teamCount);

  await db.transaction(async (tx) => {
    await tx.delete(teams).where(eq(teams.matchDayId, matchDayId));
    for (const [i, team] of drawn.entries()) {
      const [created] = await tx
        .insert(teams)
        .values({ matchDayId, name: defaultTeamNames[i] ?? `Time ${i + 1}`, sortOrder: i })
        .returning();
      await tx
        .insert(teamPlayers)
        .values(team.players.map((p) => ({ teamId: created.id, playerId: p.id })));
    }
    await tx.update(matchDays).set({ status: "teams_drawn" }).where(eq(matchDays.id, matchDayId));
  });

  revalidateMatchDay(matchDayId);
  redirect(`/admin/peladas/${matchDayId}`);
}

export async function swapPlayersAction(matchDayId: number, formData: FormData) {
  await requireAdmin();
  await assertEscalacaoEditavel(matchDayId);
  const playerA = Number(formData.get("playerA"));
  const playerB = Number(formData.get("playerB"));
  if (!Number.isInteger(playerA) || !Number.isInteger(playerB) || playerA === playerB) return;

  const dayTeams = await db.select().from(teams).where(eq(teams.matchDayId, matchDayId));
  const teamIds = dayTeams.map((t) => t.id);
  if (teamIds.length === 0) return;

  const rows = await db
    .select()
    .from(teamPlayers)
    .where(and(inArray(teamPlayers.teamId, teamIds), inArray(teamPlayers.playerId, [playerA, playerB])));
  const rowA = rows.find((r) => r.playerId === playerA);
  const rowB = rows.find((r) => r.playerId === playerB);
  if (!rowA || !rowB || rowA.teamId === rowB.teamId) return;

  await db.transaction(async (tx) => {
    await tx
      .update(teamPlayers)
      .set({ teamId: rowB.teamId })
      .where(and(eq(teamPlayers.teamId, rowA.teamId), eq(teamPlayers.playerId, playerA)));
    await tx
      .update(teamPlayers)
      .set({ teamId: rowA.teamId })
      .where(and(eq(teamPlayers.teamId, rowB.teamId), eq(teamPlayers.playerId, playerB)));
  });

  revalidateMatchDay(matchDayId);
}

export async function createGame(matchDayId: number, formData: FormData) {
  await requireAdmin();
  await assertEscalacaoEditavel(matchDayId);
  const teamAId = Number(formData.get("teamAId"));
  const teamBId = Number(formData.get("teamBId"));
  const scoreA = Number(formData.get("scoreA"));
  const scoreB = Number(formData.get("scoreB"));
  if (
    !Number.isInteger(teamAId) ||
    !Number.isInteger(teamBId) ||
    teamAId === teamBId ||
    !Number.isInteger(scoreA) ||
    !Number.isInteger(scoreB) ||
    scoreA < 0 ||
    scoreB < 0
  ) {
    redirect(`/admin/peladas/${matchDayId}?erro=dados-invalidos`);
  }

  const dayTeams = await db.select().from(teams).where(eq(teams.matchDayId, matchDayId));
  const teamIds = new Set(dayTeams.map((t) => t.id));
  if (!teamIds.has(teamAId) || !teamIds.has(teamBId)) {
    redirect(`/admin/peladas/${matchDayId}?erro=dados-invalidos`);
  }

  const existing = await db.select().from(games).where(eq(games.matchDayId, matchDayId));

  // A escalação do jogo é um snapshot dos times da pelada tirado agora. Depois
  // disso ela é editável por jogo e independente do colete.
  const lineup = await db
    .select({ playerId: teamPlayers.playerId, teamId: teamPlayers.teamId })
    .from(teamPlayers)
    .where(inArray(teamPlayers.teamId, [teamAId, teamBId]));

  await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(games)
      .values({ matchDayId, teamAId, teamBId, scoreA, scoreB, sortOrder: existing.length })
      .returning();
    if (lineup.length > 0) {
      await tx.insert(gamePlayers).values(
        lineup.map((row) => ({
          gameId: created.id,
          playerId: row.playerId,
          side: row.teamId === teamAId ? ("A" as const) : ("B" as const),
        })),
      );
    }
  });
  revalidateMatchDay(matchDayId);
}

export async function updateGameScore(matchDayId: number, gameId: number, formData: FormData) {
  await requireAdmin();
  await assertPlacarEditavel(matchDayId);
  const scoreA = Number(formData.get("scoreA"));
  const scoreB = Number(formData.get("scoreB"));
  if (!Number.isInteger(scoreA) || !Number.isInteger(scoreB) || scoreA < 0 || scoreB < 0) {
    redirect(`/admin/peladas/${matchDayId}?erro=dados-invalidos`);
  }
  await db
    .update(games)
    .set({ scoreA, scoreB })
    .where(and(eq(games.id, gameId), eq(games.matchDayId, matchDayId)));
  revalidateMatchDay(matchDayId);
}

export async function deleteGame(matchDayId: number, gameId: number) {
  await requireAdmin();
  await assertEscalacaoEditavel(matchDayId);
  await db.delete(games).where(and(eq(games.id, gameId), eq(games.matchDayId, matchDayId)));
  revalidateMatchDay(matchDayId);
}

export async function addGoal(matchDayId: number, gameId: number, formData: FormData) {
  await requireAdmin();
  await assertPlacarEditavel(matchDayId);
  const playerId = Number(formData.get("playerId"));
  const quantity = Number(formData.get("quantity") ?? 1);
  if (!Number.isInteger(playerId) || !Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
    redirect(`/admin/peladas/${matchDayId}?erro=dados-invalidos`);
  }
  const [game] = await db
    .select()
    .from(games)
    .where(and(eq(games.id, gameId), eq(games.matchDayId, matchDayId)));
  if (!game) redirect(`/admin/peladas/${matchDayId}?erro=dados-invalidos`);

  await db.insert(goals).values({ gameId, playerId, quantity });
  revalidateMatchDay(matchDayId);
}

export async function deleteGoal(matchDayId: number, goalId: number) {
  await requireAdmin();
  await db.delete(goals).where(eq(goals.id, goalId));
  revalidateMatchDay(matchDayId);
}

// Encerrar mora em ./[id]/encerrar/actions.ts: passa pela conferência da
// escalação, que é o que trava a base da avaliação. Não existe "reabrir" —
// escalação errada só se conserta excluindo a pelada.

export async function setAttendanceAdmin(
  matchDayId: number,
  playerId: number,
  status: "in" | "out",
) {
  await requireAdmin();
  await assertEscalacaoEditavel(matchDayId);
  await db
    .insert(attendances)
    .values({ matchDayId, playerId, status })
    .onConflictDoUpdate({
      target: [attendances.matchDayId, attendances.playerId],
      set: { status, updatedAt: new Date() },
    });
  revalidatePath("/");
  revalidatePath(`/admin/peladas/${matchDayId}`);
  revalidatePath(`/pelada/${matchDayId}`);
}
