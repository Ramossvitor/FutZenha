// As actions do /gerenciar que a súmula ao vivo mexeu: o createGame, que agora
// nasce pelo mesmo helper do iniciarJogo, o addGoal, que passou a gravar `side`
// e autor do lançamento, e o definirAutorDoGol, que é novo.
//
// O alvo aqui é o fluxo CLÁSSICO — placar digitado pronto, jogo que nunca fica
// "em andamento". É a metade que a suíte da súmula não cobre, e um jogo clássico
// que nascesse com `started_at` travaria o encerramento do fut para sempre.

import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { gamePlayers, games, goals } from "@/db/schema";
import { esperaRedirect } from "@/test/navigation-fake";
import { golsDoJogo, montarSumula, type Sumula } from "@/test/fixtures-sumula";
import { confirmarEncerramento } from "./encerrar/actions";
import { addGoal, createGame, definirAutorDoGol } from "./actions";

function formDeJogo(s: Sumula, scoreA: number, scoreB: number): FormData {
  const form = new FormData();
  form.set("teamAId", String(s.timeAId));
  form.set("teamBId", String(s.timeBId));
  form.set("scoreA", String(scoreA));
  form.set("scoreB", String(scoreB));
  return form;
}

const formDeAutor = (playerId: number) => {
  const f = new FormData();
  f.set("playerId", String(playerId));
  return f;
};

async function jogosDoFut(matchDayId: number) {
  return db
    .select()
    .from(games)
    .where(eq(games.matchDayId, matchDayId))
    .orderBy(asc(games.sortOrder), asc(games.id));
}

describe("createGame", () => {
  it("jogo clássico nasce com placar pronto e NUNCA em andamento", async () => {
    const s = await montarSumula();

    await createGame(s.fut.id, formDeJogo(s, 3, 1));

    const [jogo] = await jogosDoFut(s.fut.id);
    expect(jogo).toMatchObject({ scoreA: 3, scoreB: 1, startedAt: null, finishedAt: null });
  });

  it("tira o snapshot da escalação com os lados certos", async () => {
    const s = await montarSumula();
    await createGame(s.fut.id, formDeJogo(s, 0, 0));
    const [jogo] = await jogosDoFut(s.fut.id);

    const escalacao = await db
      .select({ playerId: gamePlayers.playerId, side: gamePlayers.side })
      .from(gamePlayers)
      .where(eq(gamePlayers.gameId, jogo.id));

    expect(escalacao).toHaveLength(4);
    for (const p of s.ladoA) expect(escalacao).toContainEqual({ playerId: p.id, side: "A" });
    for (const p of s.ladoB) expect(escalacao).toContainEqual({ playerId: p.id, side: "B" });
  });

  it("o sortOrder segue a contagem de jogos do fut", async () => {
    const s = await montarSumula();

    await createGame(s.fut.id, formDeJogo(s, 1, 0));
    await createGame(s.fut.id, formDeJogo(s, 2, 2));

    expect((await jogosDoFut(s.fut.id)).map((j) => j.sortOrder)).toEqual([0, 1]);
  });

  // A trava que fecha o círculo com a súmula: o encerramento agora recusa fut
  // com jogo em andamento, então um `started_at` que vazasse para o fluxo
  // clássico deixaria o fut sem saída.
  it("fut só com jogo clássico continua encerrável", async () => {
    const s = await montarSumula();
    await createGame(s.fut.id, formDeJogo(s, 2, 1));

    await esperaRedirect(confirmarEncerramento(s.fut.id));

    const [fut] = await db.select().from(games).where(eq(games.matchDayId, s.fut.id));
    expect(fut.startedAt).toBeNull();
  });
});

describe("addGoal", () => {
  it("grava o lado da escalação e quem lançou, fora do placar", async () => {
    const s = await montarSumula();
    await createGame(s.fut.id, formDeJogo(s, 1, 0));
    const [jogo] = await jogosDoFut(s.fut.id);

    await addGoal(s.fut.id, jogo.id, formDeAutor(s.ladoB[0].id));

    const [gol] = await golsDoJogo(jogo.id);
    expect(gol).toMatchObject({
      playerId: s.ladoB[0].id,
      side: "B",
      createdByPlayerId: s.admin.id,
      // O fluxo clássico digita o placar à parte: o gol não soma sozinho, e é
      // por isso que a súmula não pode desfazê-lo devolvendo ponto.
      somadoNoPlacar: false,
    });
    expect((await jogosDoFut(s.fut.id))[0]).toMatchObject({ scoreA: 1, scoreB: 0 });
  });

  it("recusa artilheiro que não entrou em campo", async () => {
    const s = await montarSumula();
    await createGame(s.fut.id, formDeJogo(s, 0, 0));
    const [jogo] = await jogosDoFut(s.fut.id);
    const deFora = await montarSumula();

    const url = await esperaRedirect(
      addGoal(deFora.fut.id, jogo.id, formDeAutor(deFora.ladoA[0].id)),
    );

    expect(url).toBe(`/fut/${deFora.fut.id}/gerenciar?erro=dados-invalidos`);
    expect(await golsDoJogo(jogo.id)).toHaveLength(0);
  });
});

describe("definirAutorDoGol", () => {
  /** Gol sem autor gravado como a súmula grava: com lado, e somado no placar. */
  async function golSemAutor(s: Sumula, side: "A" | "B") {
    await createGame(s.fut.id, formDeJogo(s, 1, 0));
    const [jogo] = await jogosDoFut(s.fut.id);
    const [gol] = await db
      .insert(goals)
      .values({ gameId: jogo.id, playerId: null, side, quantity: 1, somadoNoPlacar: true })
      .returning();
    return { jogo, gol };
  }

  it("atribui autor do mesmo lado a gol lançado sem autor", async () => {
    const s = await montarSumula();
    const { jogo, gol } = await golSemAutor(s, "A");

    await definirAutorDoGol(s.fut.id, gol.id, formDeAutor(s.ladoA[0].id));

    expect((await golsDoJogo(jogo.id))[0].playerId).toBe(s.ladoA[0].id);
  });

  it("recusa autor do lado oposto ao do gol", async () => {
    const s = await montarSumula();
    const { jogo, gol } = await golSemAutor(s, "A");

    const url = await esperaRedirect(
      definirAutorDoGol(s.fut.id, gol.id, formDeAutor(s.ladoB[0].id)),
    );

    expect(url).toBe(`/fut/${s.fut.id}/gerenciar?erro=artilheiro-fora-do-jogo`);
    expect((await golsDoJogo(jogo.id))[0].playerId).toBeNull();
  });

  it("gol que já tem autor não é reescrito por aqui", async () => {
    const s = await montarSumula();
    await createGame(s.fut.id, formDeJogo(s, 1, 0));
    const [jogo] = await jogosDoFut(s.fut.id);
    await addGoal(s.fut.id, jogo.id, formDeAutor(s.ladoA[0].id));
    const [gol] = await golsDoJogo(jogo.id);

    const url = await esperaRedirect(
      definirAutorDoGol(s.fut.id, gol.id, formDeAutor(s.ladoA[1].id)),
    );

    expect(url).toBe(`/fut/${s.fut.id}/gerenciar?erro=dados-invalidos`);
    expect((await golsDoJogo(jogo.id))[0].playerId).toBe(s.ladoA[0].id);
  });
});
