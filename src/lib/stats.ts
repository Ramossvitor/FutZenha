import "server-only";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { attendances, gamePlayers, games, goals, matchDays, players, users } from "@/db/schema";

// Estatísticas contam apenas peladas encerradas (status = finished).
//
// E apenas jogadores com conta ativa: o innerJoin com `users` em cada consulta
// abaixo é o que implementa isso. Quem foi cadastrado mas ainda não resgatou o
// convite joga normalmente e tem gols e presenças registrados — só não aparece
// nos rankings. Como tudo aqui é derivado por query, no instante em que ele
// cria a conta todo o passado dele entra nas listas sem backfill nenhum.

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
    .innerJoin(users, and(eq(users.playerId, players.id), eq(users.active, true)))
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
  // A escalação por jogo (game_players) é a fonte de verdade de quem jogou de
  // qual lado — trocar alguém de colete depois não reescreve o passado.
  const isWin = sql`(${gamePlayers.side} = 'A' and ${games.scoreA} > ${games.scoreB}) or (${gamePlayers.side} = 'B' and ${games.scoreB} > ${games.scoreA})`;
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
    .from(gamePlayers)
    .innerJoin(games, eq(gamePlayers.gameId, games.id))
    .innerJoin(matchDays, eq(games.matchDayId, matchDays.id))
    .innerJoin(players, eq(gamePlayers.playerId, players.id))
    .innerJoin(users, and(eq(users.playerId, players.id), eq(users.active, true)))
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

export type SkillRankingRow = {
  playerId: number;
  name: string;
  nickname: string | null;
  skill: number;
  /** Variação na última rodada apurada. null = a nota nunca se moveu ainda. */
  variacao: number | null;
};

/**
 * Ranking de notas. Diferente das outras funções daqui, não filtra por ano nem
 * por pelada encerrada: a nota é um estado atual do jogador, não um acumulado
 * de temporada.
 */
export async function getSkillRanking(): Promise<SkillRankingRow[]> {
  return db
    .select({
      playerId: players.id,
      name: players.name,
      nickname: players.nickname,
      skill: players.skill,
      variacao: sql<number | null>`(
        select (sh.skill_after - sh.skill_before)::float8
        from skill_history sh
        join rating_rounds rr on rr.id = sh.round_id
        join match_days md on md.id = rr.match_day_id
        where sh.player_id = ${players.id}
        order by md.date desc, rr.id desc
        limit 1
      )`,
    })
    .from(players)
    .innerJoin(users, and(eq(users.playerId, players.id), eq(users.active, true)))
    .where(eq(players.active, true))
    .orderBy(desc(players.skill), players.name);
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
    .innerJoin(users, and(eq(users.playerId, players.id), eq(users.active, true)))
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
