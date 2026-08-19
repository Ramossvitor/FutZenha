// Construtores do fut que avalia — mesmas regras da casa de fixtures.ts
// (inserts do drizzle, timestamps pelo relógio do banco).
//
// Mora aqui, e não dentro de um dos testes, porque DOIS arquivos de integração
// montam o mesmo fut de dois lados com conta: o do ciclo da rodada
// (ratings-engine) e o do voto de MVP.

import { db } from "@/db";
import {
  gamePlayers,
  games,
  ratings,
  teams,
  type Game,
  type MatchDay,
  type Player,
} from "@/db/schema";
import { criarJogadorComConta } from "./fixtures";

let sequenciaDeTimes = 0;

/** Dois times novos no fut e um jogo entre eles, com a escalação dada. */
export async function criarJogo(fut: MatchDay, ladoA: Player[], ladoB: Player[]): Promise<Game> {
  sequenciaDeTimes += 1;
  const [timeA] = await db
    .insert(teams)
    .values({ matchDayId: fut.id, name: `Time ${sequenciaDeTimes}A`, sortOrder: 0 })
    .returning();
  const [timeB] = await db
    .insert(teams)
    .values({ matchDayId: fut.id, name: `Time ${sequenciaDeTimes}B`, sortOrder: 1 })
    .returning();
  const [jogo] = await db
    .insert(games)
    .values({ matchDayId: fut.id, teamAId: timeA.id, teamBId: timeB.id })
    .returning();
  await db.insert(gamePlayers).values([
    ...ladoA.map((p) => ({ gameId: jogo.id, playerId: p.id, side: "A" as const })),
    ...ladoB.map((p) => ({ gameId: jogo.id, playerId: p.id, side: "B" as const })),
  ]);
  return jogo;
}

/** Três jogadores com conta ativa — o mínimo de um lado que avalia. */
export async function criarTrioComConta() {
  const primeiro = await criarJogadorComConta();
  const segundo = await criarJogadorComConta();
  const terceiro = await criarJogadorComConta();
  return {
    jogadores: [primeiro.jogador, segundo.jogador, terceiro.jogador],
    contas: [primeiro.conta, segundo.conta, terceiro.conta],
  };
}

/** Todos do trio dão a mesma nota (em meias-estrelas) aos outros dois, direto no banco. */
export async function avaliarTrio(roundId: number, trio: Player[], halfStars: number): Promise<void> {
  const notas = [];
  for (const rater of trio) {
    for (const rated of trio) {
      if (rater.id !== rated.id) {
        notas.push({ roundId, raterPlayerId: rater.id, ratedPlayerId: rated.id, halfStars });
      }
    }
  }
  await db.insert(ratings).values(notas);
}
