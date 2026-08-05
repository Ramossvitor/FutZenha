import "server-only";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { attendances, games, goals, matchDays, players, teamPlayers, teams } from "@/db/schema";

// Estatísticas contam apenas peladas encerradas (status = finished).

function yearFilter(year?: number): SQL | undefined {
  return year ? sql`extract(year from ${matchDays.date}) = ${year}` : undefined;
}

export async function getAvailableYears(): Promise<number[]> {
  const rows = await db
    .selectDistinct({ year: sql<number>`extract(year from ${matchDays.date})::int` })
    .from(matchDays)
    .where(eq(matchDays.status, "finished"));
  return rows.map((r) => r.year).sort((a, b) => b - a);
}

export async function getTopScorers(year?: number) {
  return db
    .select({
      playerId: players.id,
      name: players.name,
      nickname: players.nickname,
      total: sql<number>`sum(${goals.quantity})::int`,
    })
    .from(goals)
    .innerJoin(games, eq(goals.gameId, games.id))
    .innerJoin(matchDays, eq(games.matchDayId, matchDays.id))
    .innerJoin(players, eq(goals.playerId, players.id))
    .where(and(eq(matchDays.status, "finished"), yearFilter(year)))
    .groupBy(players.id, players.name, players.nickname)
    .orderBy(desc(sql`sum(${goals.quantity})`), players.name);
}

export type PlayerRecord = {
  playerId: number;
  name: string;
  nickname: string | null;
  wins: number;
  draws: number;
  losses: number;
  gamesPlayed: number;
  winRate: number;
};

export async function getPlayerRecords(year?: number, minGames = 1): Promise<PlayerRecord[]> {
  const isWin = sql`(${games.teamAId} = ${teams.id} and ${games.scoreA} > ${games.scoreB}) or (${games.teamBId} = ${teams.id} and ${games.scoreB} > ${games.scoreA})`;
  const isDraw = sql`${games.scoreA} = ${games.scoreB}`;

  const rows = await db
    .select({
      playerId: players.id,
      name: players.name,
      nickname: players.nickname,
      wins: sql<number>`sum(case when ${isWin} then 1 else 0 end)::int`,
      draws: sql<number>`sum(case when ${isDraw} then 1 else 0 end)::int`,
      gamesPlayed: sql<number>`count(*)::int`,
    })
    .from(teamPlayers)
    .innerJoin(teams, eq(teamPlayers.teamId, teams.id))
    .innerJoin(
      games,
      sql`${games.teamAId} = ${teams.id} or ${games.teamBId} = ${teams.id}`,
    )
    .innerJoin(matchDays, eq(games.matchDayId, matchDays.id))
    .innerJoin(players, eq(teamPlayers.playerId, players.id))
    .where(and(eq(matchDays.status, "finished"), yearFilter(year)))
    .groupBy(players.id, players.name, players.nickname);

  return rows
    .map((r) => ({
      ...r,
      losses: r.gamesPlayed - r.wins - r.draws,
      winRate: r.gamesPlayed > 0 ? (r.wins + r.draws * 0.5) / r.gamesPlayed : 0,
    }))
    .filter((r) => r.gamesPlayed >= minGames)
    .sort((a, b) => b.winRate - a.winRate || b.gamesPlayed - a.gamesPlayed || a.name.localeCompare(b.name));
}

export type AttendanceStat = {
  playerId: number;
  name: string;
  attended: number;
};

export async function getAttendanceStats(year?: number): Promise<{
  totalDays: number;
  perPlayer: AttendanceStat[];
}> {
  const [{ totalDays }] = await db
    .select({ totalDays: sql<number>`count(*)::int` })
    .from(matchDays)
    .where(and(eq(matchDays.status, "finished"), yearFilter(year)));

  const perPlayer = await db
    .select({
      playerId: players.id,
      name: players.name,
      attended: sql<number>`count(*)::int`,
    })
    .from(attendances)
    .innerJoin(matchDays, eq(attendances.matchDayId, matchDays.id))
    .innerJoin(players, eq(attendances.playerId, players.id))
    .where(
      and(
        eq(attendances.status, "in"),
        eq(matchDays.status, "finished"),
        yearFilter(year),
      ),
    )
    .groupBy(players.id, players.name)
    .orderBy(desc(sql`count(*)`), players.name);

  return { totalDays, perPlayer };
}
