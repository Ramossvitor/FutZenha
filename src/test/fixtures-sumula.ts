// Construtores de cenário da súmula ao vivo — mesmas regras da casa de
// fixtures.ts (inserts do drizzle, timestamps pelo relógio do banco).
//
// Mora aqui, e não dentro de um dos testes, porque DOIS arquivos de integração
// montam o mesmo fut sorteado: o da súmula e o das actions do /gerenciar, que
// precisa de um jogo com escalação para exercitar addGoal e definirAutorDoGol.

import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  games,
  goals,
  sumulaOperadores,
  teamPlayers,
  teams,
  type MatchDay,
  type Player,
} from "@/db/schema";
import {
  confirmarPresenca,
  criarFut,
  criarJogador,
  criarJogadorComConta,
  logarComo,
} from "./fixtures";

export type Sumula = {
  fut: MatchDay;
  admin: Player;
  timeAId: number;
  timeBId: number;
  ladoA: Player[];
  ladoB: Player[];
};

/**
 * Fut sorteado com dois times de dois, admin logado. `comContas` cria os
 * jogadores da escalação com conta ativa — o que a artilharia exige para
 * listar alguém (ver src/lib/stats.ts).
 */
export async function montarSumula(opcoes: { comContas?: boolean } = {}): Promise<Sumula> {
  const { jogador: admin, conta } = await criarJogadorComConta();
  await logarComo(conta);
  const fut = await criarFut({ createdByPlayerId: admin.id, status: "teams_drawn" });

  const novoJogador = async () =>
    opcoes.comContas ? (await criarJogadorComConta()).jogador : criarJogador();
  const ladoA = [await novoJogador(), await novoJogador()];
  const ladoB = [await novoJogador(), await novoJogador()];

  const [timeA] = await db
    .insert(teams)
    .values({ matchDayId: fut.id, name: "Preto", sortOrder: 0 })
    .returning();
  const [timeB] = await db
    .insert(teams)
    .values({ matchDayId: fut.id, name: "Branco", sortOrder: 1 })
    .returning();
  await db.insert(teamPlayers).values([
    ...ladoA.map((p) => ({ teamId: timeA.id, playerId: p.id })),
    ...ladoB.map((p) => ({ teamId: timeB.id, playerId: p.id })),
  ]);

  return { fut, admin, timeAId: timeA.id, timeBId: timeB.id, ladoA, ladoB };
}

/**
 * Delegação montada direto pelo banco — a action delegarSumula tem teste
 * próprio. A presença `in` não é enfeite do cenário: o guard reafirma a
 * elegibilidade a cada request, então sem ela a delegação não vale.
 */
export async function criarDelegado(fut: MatchDay) {
  const { jogador, conta } = await criarJogadorComConta();
  await confirmarPresenca(fut, jogador, { minutosAtras: 15 });
  await db.insert(sumulaOperadores).values({ matchDayId: fut.id, playerId: jogador.id });
  return { jogador, conta };
}

export function formDeTimes(teamAId: number, teamBId: number): FormData {
  const form = new FormData();
  form.set("teamAId", String(teamAId));
  form.set("teamBId", String(teamBId));
  return form;
}

export function formDeGol(side: "A" | "B", playerId?: number): FormData {
  const form = new FormData();
  form.set("side", side);
  if (playerId !== undefined) form.set("playerId", String(playerId));
  return form;
}

/** O jogo relido do banco — o que as asserções de placar conferem. */
export async function jogoDoBanco(gameId: number) {
  const [jogo] = await db.select().from(games).where(eq(games.id, gameId));
  return jogo;
}

/** Os gols do jogo em ordem de criação, desfeitos inclusive. */
export async function golsDoJogo(gameId: number) {
  return db.select().from(goals).where(eq(goals.gameId, gameId)).orderBy(asc(goals.id));
}
