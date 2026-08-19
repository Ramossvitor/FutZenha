import "server-only";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  attendances,
  gamePlayers,
  games,
  goals,
  matchDays,
  players,
  ratingRounds,
  users,
} from "@/db/schema";
import { apurarMvp, contarTitulos } from "./mvp";
import { getAgregadosMvpPorRodada } from "./ratings";
import { escopo, jogouNoGrupo, type EscopoStats } from "./stats-escopo";

// Estatísticas contam apenas futs encerrados (status = finished).
//
// E apenas jogadores com conta ativa: o innerJoin com `users` em cada consulta
// abaixo é o que implementa isso. Quem foi cadastrado mas ainda não resgatou o
// convite joga normalmente e tem gols e presenças registrados — só não aparece
// nos rankings. Como tudo aqui é derivado por query, no instante em que ele
// cria a conta todo o passado dele entra nas listas sem backfill nenhum.

// O recorte (`escopo`, `jogouNoGrupo`) mora em ./stats-escopo, módulo puro que o
// vitest alcança — aqui não dá, por causa do `server-only` e do `@/db`. Ver o
// comentário de lá: são os dois predicados que falham em silêncio.
export type { EscopoStats };

export async function getAvailableYears(e: EscopoStats = {}): Promise<number[]> {
  const rows = await db
    .selectDistinct({ year: sql<number>`extract(year from ${matchDays.date})::int` })
    .from(matchDays)
    .where(escopo(e));
  return rows.map((r) => r.year).sort((a, b) => b - a);
}

export async function getTopScorers(e: EscopoStats = {}) {
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
    // O innerJoin em players também é filtro: gol sem autor (gol contra /
    // ninguém viu, player_id nulo) soma no placar mas não credita artilharia.
    .innerJoin(players, eq(goals.playerId, players.id))
    .innerJoin(users, and(eq(users.playerId, players.id), eq(users.active, true)))
    // Gol desfeito na súmula ao vivo é soft-delete — sem este filtro ele
    // voltaria a contar aqui.
    .where(and(escopo(e), isNull(goals.desfeitoEm)))
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

export async function getPlayerRecords(
  e: EscopoStats = {},
  minGames = 1,
): Promise<PlayerRecord[]> {
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
    .where(escopo(e))
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
 * por fut encerrado: a nota é um estado atual do jogador, não um acumulado
 * de temporada.
 *
 * Com `groupId`, a nota exibida continua sendo a **global** — a lista só é
 * restrita a quem jogou futs daquele grupo. Não existe nota por grupo, e
 * inventar uma (a média das estrelas recebidas só nas rodadas do grupo) seria
 * pior que a falta: viria noutra escala (1–5 ao lado de 0–10 na mesma tela), sem
 * histórico nem denúncia, e furaria o anonimato — num grupo pequeno a média se
 * apoia em duas ou três avaliações, e com n=2 ela praticamente revela o voto
 * individual que src/lib/anonimato.ts protege contra pistas bem mais fracas.
 */
export async function getSkillRanking(e: EscopoStats = {}): Promise<SkillRankingRow[]> {
  // Quem entrou em campo em algum fut encerrado do grupo. O predicado vem de
  // ./stats-escopo porque é o caminho que NÃO passa por `escopo()` — e por isso
  // é o mais fácil de deixar para trás numa mudança futura.
  const quemJogou = e.groupId
    ? db
        .selectDistinct({ id: gamePlayers.playerId })
        .from(gamePlayers)
        .innerJoin(games, eq(gamePlayers.gameId, games.id))
        .innerJoin(matchDays, eq(games.matchDayId, matchDays.id))
        .where(jogouNoGrupo(e.groupId))
    : null;

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
    .where(
      and(
        eq(players.active, true),
        quemJogou ? inArray(players.id, quemJogou) : undefined,
      ),
    )
    .orderBy(desc(players.skill), players.name);
}

export type MvpRankingRow = {
  playerId: number;
  name: string;
  nickname: string | null;
  titulos: number;
};

/**
 * Ranking de MVPs: quantas vezes cada um foi eleito melhor em campo.
 *
 * A assinatura EXIGE groupId de propósito — o MVP é a primeira métrica só de
 * grupo do produto (fut avulso tem MVP na página dele, mas não ranqueia), e o
 * tipo é o que impede um call site futuro de somar a plataforma inteira sem
 * perceber. A ressalva de getSkillRanking sobre métrica por grupo não se
 * aplica: aqui não há escala nova nem média de poucos votos exposta — só a
 * contagem de títulos, e o voto individual continua secreto (inclusive pelo
 * piso de MIN_VOTOS_PARA_MVP, aplicado dentro de apurarMvp).
 *
 * Derivado na leitura com a MESMA agregação e apuração do fechamento
 * (getAgregadosMvpPorRodada + apurarMvp): as duas telas nunca discordam, e
 * denúncia aceita depois da apuração reflete aqui sozinha, como a nota reflete
 * no replay.
 */
export async function getMvpRanking(
  e: EscopoStats & { groupId: number },
): Promise<MvpRankingRow[]> {
  const porRodada = await getAgregadosMvpPorRodada(
    db,
    and(escopo(e), eq(ratingRounds.status, "closed")),
  );

  const titulos = contarTitulos([...porRodada.values()].map(apurarMvp));
  // Alcançável quando toda rodada do escopo fica abaixo do piso de votos — e
  // o inArray abaixo não aceita lista vazia.
  if (titulos.size === 0) return [];

  const nomes = await db
    .select({ playerId: players.id, name: players.name, nickname: players.nickname })
    .from(players)
    .innerJoin(users, and(eq(users.playerId, players.id), eq(users.active, true)))
    .where(inArray(players.id, [...titulos.keys()]));

  return nomes
    .map((n) => ({ ...n, titulos: titulos.get(n.playerId)! }))
    .sort((a, b) => b.titulos - a.titulos || a.name.localeCompare(b.name));
}

export type AttendanceStat = {
  playerId: number;
  name: string;
  nickname: string | null;
  attended: number;
};

export async function getAttendanceStats(e: EscopoStats = {}): Promise<{
  totalDays: number;
  perPlayer: AttendanceStat[];
}> {
  // Só fut encerrado, nos dois lados da razão. O denominador contava toda
  // fut do escopo, inclusive a de sábado que ainda vai acontecer: quem já
  // tinha confirmado aparecia com aproveitamento pior do que tem, e quem não
  // tinha confirmado ainda era punido por um fut que não aconteceu.
  const encerradas = and(eq(matchDays.status, "finished"), escopo(e));

  const [{ totalDays }] = await db
    .select({ totalDays: sql<number>`count(*)::int` })
    .from(matchDays)
    .where(encerradas);

  // `nickname` entra aqui para igualar as outras quatro consultas de stats:
  // sem ele, a linha de presença era a única do produto que mostrava o nome de
  // batismo enquanto o resto do app chama a pessoa pelo apelido.
  const perPlayer = await db
    .select({
      playerId: players.id,
      name: players.name,
      nickname: players.nickname,
      attended: sql<number>`count(*)::int`,
    })
    .from(attendances)
    .innerJoin(matchDays, eq(attendances.matchDayId, matchDays.id))
    .innerJoin(players, eq(attendances.playerId, players.id))
    .innerJoin(users, and(eq(users.playerId, players.id), eq(users.active, true)))
    // `in` é presença de verdade: quem ficou na espera não jogou, e quem
    // confirmou e não apareceu virou `no_show` no encerramento (ver
    // marcarFaltasAutomaticas). Os dois ficam de fora sem filtro extra.
    .where(and(eq(attendances.status, "in"), encerradas))
    .groupBy(players.id, players.name, players.nickname)
    .orderBy(desc(sql`count(*)`), players.name);

  return { totalDays, perPlayer };
}
