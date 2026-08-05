import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  gamePlayers,
  games,
  matchDays,
  players,
  ratingRoundRaters,
  ratingRounds,
  ratings,
  users,
  type RatingRound,
} from "@/db/schema";
import { companheirosPorJogador, type EscalacaoRow } from "./lineup";

// Prazos do ciclo de avaliação, em dias. São gravados como timestamp absoluto na
// criação de cada rodada/denúncia — mudar aqui não mexe no que já está em curso.
export const PRAZO_AVALIACAO_DIAS = 2; // encerrar a pelada → avaliar
export const PRAZO_DENUNCIA_DIAS = 2; // apurar a rodada → reportar nota injusta
export const PRAZO_ADMIN_DIAS = 3; // reportar → admin responder (silêncio = aceita)

// Denúncia só faz sentido a partir daqui: com uma única avaliação recebida,
// reportar seria apontar o dedo para uma pessoa óbvia.
export const MIN_AVALIACOES_PARA_DENUNCIAR = 2;

/** `now() + N dias` calculado pelo Postgres, não pelo relógio do app. */
export function prazoEmDias(dias: number) {
  return sql<Date>`now() + make_interval(days => ${dias}::int)`;
}

export async function getEscalacaoDaPelada(matchDayId: number): Promise<EscalacaoRow[]> {
  return db
    .select({
      gameId: gamePlayers.gameId,
      playerId: gamePlayers.playerId,
      side: gamePlayers.side,
    })
    .from(gamePlayers)
    .innerJoin(games, eq(gamePlayers.gameId, games.id))
    .where(eq(games.matchDayId, matchDayId));
}

export type Companheiro = {
  playerId: number;
  name: string;
  nickname: string | null;
  isGoalkeeper: boolean;
};

/**
 * Quem o jogador avalia nesta pelada: todos que dividiram o lado com ele em
 * algum jogo. Vazio se ele não jogou ou se não teve companheiro.
 */
export async function getCompanheiros(
  matchDayId: number,
  playerId: number,
): Promise<Companheiro[]> {
  const companheiros = companheirosPorJogador(await getEscalacaoDaPelada(matchDayId));
  const ids = [...(companheiros.get(playerId) ?? [])];
  if (ids.length === 0) return [];

  return db
    .select({
      playerId: players.id,
      name: players.name,
      nickname: players.nickname,
      isGoalkeeper: players.isGoalkeeper,
    })
    .from(players)
    .where(inArray(players.id, ids))
    .orderBy(players.name);
}

export type RaterElegivel = { playerId: number; userId: number };

/**
 * Quem pode avaliar numa pelada: jogou, tem pelo menos um companheiro e tem
 * conta ativa. Vira o denominador congelado do "todos já avaliaram".
 */
export async function getRatersElegiveis(matchDayId: number): Promise<RaterElegivel[]> {
  const companheiros = companheirosPorJogador(await getEscalacaoDaPelada(matchDayId));
  const comCompanheiro = [...companheiros]
    .filter(([, conjunto]) => conjunto.size > 0)
    .map(([playerId]) => playerId);
  if (comCompanheiro.length === 0) return [];

  return db
    .select({ playerId: users.playerId, userId: users.id })
    .from(users)
    .where(and(inArray(users.playerId, comCompanheiro), eq(users.active, true)));
}

export async function getRodadaDaPelada(matchDayId: number): Promise<RatingRound | undefined> {
  const [round] = await db
    .select()
    .from(ratingRounds)
    .where(eq(ratingRounds.matchDayId, matchDayId));
  return round;
}

export type RodadaAberta = {
  round: RatingRound;
  matchDayDate: string;
  location: string;
  jaEnviou: boolean;
};

/** Rodadas abertas em que este jogador é um dos avaliadores esperados. */
export async function getRodadasAbertasDoJogador(playerId: number): Promise<RodadaAberta[]> {
  const rows = await db
    .select({
      round: ratingRounds,
      matchDayDate: matchDays.date,
      location: matchDays.location,
      submittedAt: ratingRoundRaters.submittedAt,
    })
    .from(ratingRoundRaters)
    .innerJoin(ratingRounds, eq(ratingRoundRaters.roundId, ratingRounds.id))
    .innerJoin(matchDays, eq(ratingRounds.matchDayId, matchDays.id))
    .where(and(eq(ratingRoundRaters.playerId, playerId), eq(ratingRounds.status, "open")))
    .orderBy(ratingRounds.deadlineAt);

  return rows.map((r) => ({
    round: r.round,
    matchDayDate: r.matchDayDate,
    location: r.location,
    jaEnviou: r.submittedAt !== null,
  }));
}

/** O que este jogador já enviou nesta rodada, para reabrir o formulário. */
export async function getMinhasAvaliacoes(
  roundId: number,
  raterPlayerId: number,
): Promise<Map<number, number>> {
  const rows = await db
    .select({ ratedPlayerId: ratings.ratedPlayerId, stars: ratings.stars })
    .from(ratings)
    .where(and(eq(ratings.roundId, roundId), eq(ratings.raterPlayerId, raterPlayerId)));
  return new Map(rows.map((r) => [r.ratedPlayerId, r.stars]));
}

export type PendenciaDaRodada = { total: number; pendentes: number };

export async function getPendenciasDaRodada(roundId: number): Promise<PendenciaDaRodada> {
  // Conta desativada depois da abertura não pode travar a rodada para sempre.
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      pendentes: sql<number>`count(*) filter (
        where ${ratingRoundRaters.submittedAt} is null and ${users.active}
      )::int`,
    })
    .from(ratingRoundRaters)
    .innerJoin(users, eq(ratingRoundRaters.userId, users.id))
    .where(eq(ratingRoundRaters.roundId, roundId));
  return row ?? { total: 0, pendentes: 0 };
}
