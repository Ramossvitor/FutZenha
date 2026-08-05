"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { attendances, games, matchDays, players, teamPlayers, teams } from "@/db/schema";
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

export async function deleteMatchDay(matchDayId: number) {
  await requireAdmin();
  await db.delete(matchDays).where(eq(matchDays.id, matchDayId));
  revalidatePath("/");
  revalidatePath("/admin/peladas");
  redirect("/admin/peladas");
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

  const [matchDay] = await db.select().from(matchDays).where(eq(matchDays.id, matchDayId));
  if (!matchDay || matchDay.status === "finished") {
    redirect(`/admin/peladas/${matchDayId}?erro=pelada-encerrada`);
  }

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

export async function setAttendanceAdmin(
  matchDayId: number,
  playerId: number,
  status: "in" | "out",
) {
  await requireAdmin();
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
