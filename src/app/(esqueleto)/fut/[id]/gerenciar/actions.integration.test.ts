// As actions do /gerenciar que a súmula ao vivo mexeu: o createGame, que agora
// nasce pelo mesmo helper do iniciarJogo, o addGoal, que passou a gravar `side`
// e autor do lançamento, e o definirAutorDoGol, que é novo.
//
// O alvo aqui é o fluxo CLÁSSICO — placar digitado pronto, jogo que nunca fica
// "em andamento". É a metade que a suíte da súmula não cobre, e um jogo clássico
// que nascesse com `started_at` travaria o encerramento do fut para sempre.

import { asc, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db";
import {
  gamePlayers,
  games,
  goals,
  matchDays,
  notifications,
  ratingRounds,
} from "@/db/schema";
import { JANELA_CORRECAO_HORAS } from "@/lib/regras";
import { esperaRedirect } from "@/test/navigation-fake";
import { golsDoJogo, montarSumula, type Sumula } from "@/test/fixtures-sumula";
import { criarFut, criarJogadorComConta, logarComo } from "@/test/fixtures";
import { criarJogo, criarTrioComConta } from "@/test/fixtures-avaliacao";
import { confirmarEncerramento } from "./encerrar/actions";
import {
  addGoal,
  createGame,
  definirAutorDoGol,
  updateGameScore,
  updateMatchDay,
} from "./actions";

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

const formDePlacar = (scoreA: number, scoreB: number) => {
  const f = new FormData();
  f.set("scoreA", String(scoreA));
  f.set("scoreB", String(scoreB));
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

// A janela de correção só existia em SQL, sem teste em nenhuma das três
// camadas: o `assertPlacarEditavel` roda uma expressão de intervalo montada em
// FIM_DA_JANELA_CORRECAO, e o mesmo fragmento alimenta o `segundosDeJanela` que
// o painel mostra. Enquanto ninguém exercitava isso, um erro de SQL só
// apareceria em produção, na hora em que alguém fosse corrigir um placar.
describe("janela de correção de placar", () => {
  /**
   * Fut encerrado e com o `finished_at` recuado pelo relógio do POSTGRES — a
   * regra da casa: nada de `new Date()` em SQL cru.
   */
  async function futEncerradoHa(horas: number) {
    const s = await montarSumula();
    await createGame(s.fut.id, formDeJogo(s, 1, 0));
    await esperaRedirect(confirmarEncerramento(s.fut.id));
    await db
      .update(matchDays)
      .set({ finishedAt: sql`now() - make_interval(hours => ${horas}::int)` })
      .where(eq(matchDays.id, s.fut.id));
    const [jogo] = await jogosDoFut(s.fut.id);
    return { s, jogo };
  }

  it("aceita a correção dentro da janela", async () => {
    const { s, jogo } = await futEncerradoHa(JANELA_CORRECAO_HORAS - 1);

    await updateGameScore(s.fut.id, jogo.id, formDePlacar(4, 2));

    expect((await jogosDoFut(s.fut.id))[0]).toMatchObject({ scoreA: 4, scoreB: 2 });
  });

  it("recusa depois de a janela fechar, sem tocar no placar", async () => {
    const { s, jogo } = await futEncerradoHa(JANELA_CORRECAO_HORAS + 1);

    const url = await esperaRedirect(updateGameScore(s.fut.id, jogo.id, formDePlacar(4, 2)));

    expect(url).toBe(`/fut/${s.fut.id}/gerenciar?erro=janela-encerrada`);
    expect((await jogosDoFut(s.fut.id))[0]).toMatchObject({ scoreA: 1, scoreB: 0 });
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

// A data de um fut encerrado é o passado de todo mundo: `skill.ts` ordena o
// replay por `matchDayDate`, e a sequência de presenças da zenha conta sobre a
// mesma ordem. Mudar a data de um fut que já entrou nessas duas contas reescreve
// nota e streak sem aviso — e o replay é sempre do zero, então não há como
// desfazer depois.
describe("data travada do fut encerrado", () => {
  const formDeFut = (campos: Partial<Record<string, string>> = {}) => {
    const form = new FormData();
    form.set("date", campos.date ?? "2026-08-22");
    form.set("startTime", campos.startTime ?? "20:00");
    form.set("endTime", campos.endTime ?? "");
    form.set("location", campos.location ?? "Quadra de Teste");
    form.set("notes", campos.notes ?? "");
    return form;
  };

  /** Um fut encerrado, com o admin logado. */
  async function futEncerrado() {
    const s = await montarSumula();
    await db
      .update(matchDays)
      .set({ date: "2026-08-22", startTime: "20:00", status: "finished" })
      .where(eq(matchDays.id, s.fut.id));
    return s;
  }

  it("recusa mudar a data, e não grava nada", async () => {
    const s = await futEncerrado();

    const url = await esperaRedirect(
      updateMatchDay(s.fut.id, formDeFut({ date: "2026-08-29" })),
    );

    expect(url).toBe(`/fut/${s.fut.id}/gerenciar?erro=data-travada`);
    const [linha] = await db.select().from(matchDays).where(eq(matchDays.id, s.fut.id));
    expect(linha.date).toBe("2026-08-22");
  });

  it("recusa mudar o horário pelo mesmo motivo", async () => {
    const s = await futEncerrado();

    const url = await esperaRedirect(
      updateMatchDay(s.fut.id, formDeFut({ startTime: "21:30" })),
    );

    expect(url).toBe(`/fut/${s.fut.id}/gerenciar?erro=data-travada`);
    const [linha] = await db.select().from(matchDays).where(eq(matchDays.id, s.fut.id));
    expect(linha.startTime).toBe("20:00:00");
  });

  // A trava é só sobre a ORDEM. Local não entra em ordem nenhuma, e corrigir o
  // endereço de um fut passado tem que continuar possível.
  it("deixa corrigir o local, que não entra em ordem nenhuma", async () => {
    const s = await futEncerrado();

    // Sem `esperaRedirect`: o caminho de sucesso do `updateMatchDay` revalida e
    // volta, quem redireciona é só a recusa.
    await updateMatchDay(s.fut.id, formDeFut({ location: "Quadra Nova" }));

    const [linha] = await db.select().from(matchDays).where(eq(matchDays.id, s.fut.id));
    expect(linha.location).toBe("Quadra Nova");
    expect(linha.date).toBe("2026-08-22");
  });

  // O escape do `dataAtual`: reenviar a MESMA data de um fut antigo não pode
  // esbarrar no limite de faixa do formulário, senão corrigir o local de um fut
  // de mais de uma semana atrás viraria "dados inválidos".
  it("fut aberto e antigo aceita o local novo com a data velha", async () => {
    const s = await montarSumula();
    await db
      .update(matchDays)
      .set({ date: sql`((now() at time zone 'America/Sao_Paulo')::date - 30)` })
      .where(eq(matchDays.id, s.fut.id));
    const [antes] = await db.select().from(matchDays).where(eq(matchDays.id, s.fut.id));

    await updateMatchDay(s.fut.id, formDeFut({ date: antes.date, location: "Quadra Nova" }));

    const [depois] = await db.select().from(matchDays).where(eq(matchDays.id, s.fut.id));
    expect(depois.location).toBe("Quadra Nova");
    expect(depois.date).toBe(antes.date);
  });
});

// Dois cliques simultâneos em "encerrar". A checagem de `status === 'finished'`
// lá em cima roda ANTES da transação, então os dois passam por ela e chegam
// juntos no lock — quem decide é o `UPDATE ... WHERE status <> 'finished'
// RETURNING`. Sem ele o segundo commit re-notificaria todo mundo e mandaria o
// congelamento consumir multiplicador de novo.
//
// Os testes que já existiam chamavam o encerramento em SEQUÊNCIA, e aí o
// primeiro `redirect` sai antes da transação: a guarda nunca era exercitada.
describe("encerramento concorrente", () => {
  it("dois encerramentos simultâneos produzem UM encerramento só", async () => {
    // Trios dos dois lados, e não a súmula de 2×2: a rodada de avaliação só
    // abre com MIN_GRUPO_AVALIACAO companheiros de lado, e sem rodada o teste
    // não veria a metade mais cara do encerramento.
    const { jogador: admin, conta } = await criarJogadorComConta();
    await logarComo(conta);
    const fut = await criarFut({ createdByPlayerId: admin.id, status: "teams_drawn" });
    const timeA = await criarTrioComConta();
    const timeB = await criarTrioComConta();
    await criarJogo(fut, timeA.jogadores, timeB.jogadores);
    const s = { fut };

    const resultados = await Promise.allSettled([
      confirmarEncerramento(s.fut.id),
      confirmarEncerramento(s.fut.id),
    ]);

    // As duas "terminam" — uma encerrando, a outra saindo pela guarda ou pelo
    // redirect. O que importa é o estado que sobra.
    expect(resultados).toHaveLength(2);

    const [linha] = await db.select().from(matchDays).where(eq(matchDays.id, s.fut.id));
    expect(linha.status).toBe("finished");

    // Uma rodada só: duas reabririam a avaliação e duplicariam o eleitorado.
    const rodadas = await db
      .select()
      .from(ratingRounds)
      .where(eq(ratingRounds.matchDayId, s.fut.id));
    expect(rodadas).toHaveLength(1);

    // E um aviso de encerramento por pessoa, não dois.
    const avisos = await db
      .select()
      .from(notifications)
      .where(eq(notifications.type, "fut_encerrado"));
    const porJogador = new Map<number, number>();
    for (const a of avisos) porJogador.set(a.playerId, (porJogador.get(a.playerId) ?? 0) + 1);
    for (const total of porJogador.values()) expect(total).toBe(1);
  });
});
