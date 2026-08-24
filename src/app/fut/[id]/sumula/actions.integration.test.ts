// A súmula ao vivo contra o banco de verdade: o jogo que nasce 0×0 em
// andamento, o lançamento que incrementa placar e grava o gol no mesmo commit,
// a regra do desfazer (último do lado para o delegado, qualquer um para o
// admin), a fronteira da delegação e o bloqueio do encerramento com jogo
// aberto. A matriz pura de decisão já está travada em src/lib/sumula.test.ts —
// aqui o alvo é a composição com o Postgres, os guards e a concorrência.

import { and, asc, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { addGoal } from "@/app/fut/[id]/gerenciar/actions";
import { confirmarEncerramento } from "@/app/fut/[id]/gerenciar/encerrar/actions";
import { db } from "@/db";
import {
  attendances,
  gamePlayers,
  games,
  matchDays,
  sumulaOperadores,
  teamPlayers,
  teams,
  trocasDeLado,
  users,
} from "@/db/schema";
import { companheirosPorJogador } from "@/lib/lineup";
import { getEscalacaoDoFut } from "@/lib/ratings";
import { getPlayerRecords, getTopScorers } from "@/lib/stats";
import {
  confirmarPresenca,
  criarJogador,
  criarJogadorComConta,
  deslogar,
  logarComo,
} from "@/test/fixtures";
import { criarGrupo, entrarNoGrupo } from "@/test/fixtures-grupo";
import {
  criarDelegado,
  formDeGol,
  formDeTimes,
  golsDoJogo,
  jogoDoBanco,
  montarSumula,
  type Sumula,
} from "@/test/fixtures-sumula";
import { esperaNotFound, esperaRedirect } from "@/test/navigation-fake";
import {
  delegarSumula,
  desfazerLancamento,
  finalizarJogo,
  iniciarJogo,
  lancarGol,
  revogarSumula,
  trocarDeLado,
} from "./actions";

async function abrirJogo(s: Sumula) {
  await iniciarJogo(s.fut.id, formDeTimes(s.timeAId, s.timeBId));
  const [jogo] = await db
    .select()
    .from(games)
    .where(eq(games.matchDayId, s.fut.id))
    .orderBy(asc(games.id));
  return jogo;
}

/** O lado do jogador NAQUELE jogo — a escalação, não o colete. */
async function ladoNoJogo(gameId: number, playerId: number) {
  const [linha] = await db
    .select({ side: gamePlayers.side })
    .from(gamePlayers)
    .where(and(eq(gamePlayers.gameId, gameId), eq(gamePlayers.playerId, playerId)));
  return linha?.side ?? null;
}

/** O colete do jogador no fut — o que o próximo jogo vai copiar. */
async function timeDoJogador(matchDayId: number, playerId: number) {
  const linhas = await db
    .select({ teamId: teamPlayers.teamId })
    .from(teamPlayers)
    .innerJoin(teams, eq(teams.id, teamPlayers.teamId))
    .where(and(eq(teams.matchDayId, matchDayId), eq(teamPlayers.playerId, playerId)));
  // Um colete por fut: mais de um seria a troca deixando rastro nos dois times.
  expect(linhas.length).toBeLessThanOrEqual(1);
  return linhas[0]?.teamId ?? null;
}

async function trocasDoJogo(gameId: number) {
  return db
    .select()
    .from(trocasDeLado)
    .where(eq(trocasDeLado.gameId, gameId))
    .orderBy(asc(trocasDeLado.id));
}

describe("iniciarJogo", () => {
  it("abre 0×0 em andamento com o snapshot da escalação", async () => {
    const s = await montarSumula();

    const jogo = await abrirJogo(s);

    expect(jogo).toMatchObject({ scoreA: 0, scoreB: 0, finishedAt: null });
    expect(jogo.startedAt).not.toBeNull();
    const escalacao = await db
      .select({ playerId: gamePlayers.playerId, side: gamePlayers.side })
      .from(gamePlayers)
      .where(eq(gamePlayers.gameId, jogo.id));
    expect(escalacao).toHaveLength(4);
    for (const p of s.ladoA) {
      expect(escalacao).toContainEqual({ playerId: p.id, side: "A" });
    }
    for (const p of s.ladoB) {
      expect(escalacao).toContainEqual({ playerId: p.id, side: "B" });
    }
  });

  it("um jogo aberto por vez: o segundo é recusado", async () => {
    const s = await montarSumula();
    await abrirJogo(s);

    const url = await esperaRedirect(iniciarJogo(s.fut.id, formDeTimes(s.timeAId, s.timeBId)));

    expect(url).toBe(`/fut/${s.fut.id}/sumula?erro=ja-tem-jogo-aberto`);
    expect(await db.select().from(games).where(eq(games.matchDayId, s.fut.id))).toHaveLength(1);
  });

  it("finalizado o anterior, o próximo abre com sort_order seguinte", async () => {
    const s = await montarSumula();
    const primeiro = await abrirJogo(s);
    await finalizarJogo(s.fut.id, primeiro.id);

    await iniciarJogo(s.fut.id, formDeTimes(s.timeAId, s.timeBId));

    const jogos = await db
      .select()
      .from(games)
      .where(eq(games.matchDayId, s.fut.id))
      .orderBy(asc(games.sortOrder));
    expect(jogos).toHaveLength(2);
    expect(jogos[1].sortOrder).toBe(1);
  });

  it("delegado com a súmula inicia jogo", async () => {
    const s = await montarSumula();
    const delegado = await criarDelegado(s.fut);
    await logarComo(delegado.conta);

    const jogo = await abrirJogo(s);

    expect(jogo.startedAt).not.toBeNull();
  });

  it("quem não opera cai no mesmo 404 do guard", async () => {
    const s = await montarSumula();
    const { conta } = await criarJogadorComConta();
    await logarComo(conta);

    await esperaNotFound(iniciarJogo(s.fut.id, formDeTimes(s.timeAId, s.timeBId)));
  });

  it("fut encerrado recusa", async () => {
    const s = await montarSumula();
    await db
      .update(matchDays)
      .set({ status: "finished", finishedAt: sql`now()` })
      .where(eq(matchDays.id, s.fut.id));

    const url = await esperaRedirect(iniciarJogo(s.fut.id, formDeTimes(s.timeAId, s.timeBId)));

    expect(url).toBe(`/fut/${s.fut.id}/sumula?erro=fut-encerrado`);
  });
});

describe("lancarGol", () => {
  it("incrementa o placar e grava o lançamento no mesmo commit", async () => {
    const s = await montarSumula();
    const jogo = await abrirJogo(s);

    await lancarGol(s.fut.id, jogo.id, formDeGol("A", s.ladoA[0].id));

    expect(await jogoDoBanco(jogo.id)).toMatchObject({ scoreA: 1, scoreB: 0 });
    const [gol] = await golsDoJogo(jogo.id);
    expect(gol).toMatchObject({
      playerId: s.ladoA[0].id,
      side: "A",
      quantity: 1,
      createdByPlayerId: s.admin.id,
      desfeitoEm: null,
    });
  });

  it("sem autor soma no placar sem creditar ninguém", async () => {
    const s = await montarSumula();
    const jogo = await abrirJogo(s);

    await lancarGol(s.fut.id, jogo.id, formDeGol("B"));

    expect(await jogoDoBanco(jogo.id)).toMatchObject({ scoreA: 0, scoreB: 1 });
    const [gol] = await golsDoJogo(jogo.id);
    expect(gol).toMatchObject({ playerId: null, side: "B" });
  });

  it("autor escalado do outro lado é recusado sem tocar no placar", async () => {
    const s = await montarSumula();
    const jogo = await abrirJogo(s);

    const url = await esperaRedirect(
      lancarGol(s.fut.id, jogo.id, formDeGol("A", s.ladoB[0].id)),
    );

    expect(url).toBe(`/fut/${s.fut.id}/sumula?erro=artilheiro-fora-do-jogo`);
    expect(await jogoDoBanco(jogo.id)).toMatchObject({ scoreA: 0, scoreB: 0 });
    expect(await golsDoJogo(jogo.id)).toHaveLength(0);
  });

  it("jogo finalizado recusa e não grava nada", async () => {
    const s = await montarSumula();
    const jogo = await abrirJogo(s);
    await finalizarJogo(s.fut.id, jogo.id);

    const url = await esperaRedirect(
      lancarGol(s.fut.id, jogo.id, formDeGol("A", s.ladoA[0].id)),
    );

    expect(url).toBe(`/fut/${s.fut.id}/sumula?erro=jogo-nao-esta-aberto`);
    expect(await jogoDoBanco(jogo.id)).toMatchObject({ scoreA: 0, scoreB: 0 });
    expect(await golsDoJogo(jogo.id)).toHaveLength(0);
  });
});

describe("desfazerLancamento", () => {
  it("decrementa o placar e marca quem desfez, sem apagar a linha", async () => {
    const s = await montarSumula();
    const jogo = await abrirJogo(s);
    await lancarGol(s.fut.id, jogo.id, formDeGol("A", s.ladoA[0].id));
    const [gol] = await golsDoJogo(jogo.id);

    await desfazerLancamento(s.fut.id, gol.id);

    expect(await jogoDoBanco(jogo.id)).toMatchObject({ scoreA: 0, scoreB: 0 });
    const [desfeito] = await golsDoJogo(jogo.id);
    expect(desfeito.desfeitoEm).not.toBeNull();
    expect(desfeito.desfeitoPorPlayerId).toBe(s.admin.id);
  });

  it("delegado só desfaz o último ativo do lado", async () => {
    const s = await montarSumula();
    const delegado = await criarDelegado(s.fut);
    await logarComo(delegado.conta);
    const jogo = await abrirJogo(s);
    await lancarGol(s.fut.id, jogo.id, formDeGol("A", s.ladoA[0].id));
    await lancarGol(s.fut.id, jogo.id, formDeGol("A", s.ladoA[1].id));
    const [primeiro, segundo] = await golsDoJogo(jogo.id);

    const url = await esperaRedirect(desfazerLancamento(s.fut.id, primeiro.id));
    expect(url).toBe(`/fut/${s.fut.id}/sumula?erro=desfazer-indisponivel`);
    expect(await jogoDoBanco(jogo.id)).toMatchObject({ scoreA: 2 });

    await desfazerLancamento(s.fut.id, segundo.id);
    expect(await jogoDoBanco(jogo.id)).toMatchObject({ scoreA: 1 });

    // Desfeito o último, o anterior VIRA o último ativo do lado — o desfazer
    // em cadeia é deliberado: errou duas vezes seguidas, corrige as duas.
    await desfazerLancamento(s.fut.id, primeiro.id);
    expect(await jogoDoBanco(jogo.id)).toMatchObject({ scoreA: 0 });
  });

  it("o recorte é por lado: gol do outro time não tranca o desfazer", async () => {
    const s = await montarSumula();
    const delegado = await criarDelegado(s.fut);
    await logarComo(delegado.conta);
    const jogo = await abrirJogo(s);
    await lancarGol(s.fut.id, jogo.id, formDeGol("A", s.ladoA[0].id));
    await lancarGol(s.fut.id, jogo.id, formDeGol("B", s.ladoB[0].id));
    const [golDoA] = await golsDoJogo(jogo.id);

    // O gol do B veio depois, mas o do A continua sendo o último DO LADO A.
    await desfazerLancamento(s.fut.id, golDoA.id);

    expect(await jogoDoBanco(jogo.id)).toMatchObject({ scoreA: 0, scoreB: 1 });
  });

  it("admin desfaz lançamento antigo do jogo aberto", async () => {
    const s = await montarSumula();
    const jogo = await abrirJogo(s);
    await lancarGol(s.fut.id, jogo.id, formDeGol("A", s.ladoA[0].id));
    await lancarGol(s.fut.id, jogo.id, formDeGol("A", s.ladoA[1].id));
    const [primeiro] = await golsDoJogo(jogo.id);

    await desfazerLancamento(s.fut.id, primeiro.id);

    expect(await jogoDoBanco(jogo.id)).toMatchObject({ scoreA: 1 });
  });

  it("depois de finalizado, nem o admin desfaz pelo painel", async () => {
    const s = await montarSumula();
    const jogo = await abrirJogo(s);
    await lancarGol(s.fut.id, jogo.id, formDeGol("A", s.ladoA[0].id));
    const [gol] = await golsDoJogo(jogo.id);
    await finalizarJogo(s.fut.id, jogo.id);

    const url = await esperaRedirect(desfazerLancamento(s.fut.id, gol.id));

    expect(url).toBe(`/fut/${s.fut.id}/sumula?erro=desfazer-indisponivel`);
    expect(await jogoDoBanco(jogo.id)).toMatchObject({ scoreA: 1 });
  });

  it("desfazer duas vezes não decrementa duas vezes", async () => {
    const s = await montarSumula();
    const jogo = await abrirJogo(s);
    await lancarGol(s.fut.id, jogo.id, formDeGol("A", s.ladoA[0].id));
    const [gol] = await golsDoJogo(jogo.id);
    await desfazerLancamento(s.fut.id, gol.id);

    // O gol já desfeito some da consulta de lançamento ativo — o segundo
    // toque é indistinguível de um id inventado.
    const url = await esperaRedirect(desfazerLancamento(s.fut.id, gol.id));

    expect(url).toBe(`/fut/${s.fut.id}/sumula?erro=dados-invalidos`);
    expect(await jogoDoBanco(jogo.id)).toMatchObject({ scoreA: 0 });
  });
});

describe("finalizarJogo", () => {
  it("carimba o fim; o segundo toque recusa", async () => {
    const s = await montarSumula();
    const jogo = await abrirJogo(s);

    await finalizarJogo(s.fut.id, jogo.id);

    expect((await jogoDoBanco(jogo.id)).finishedAt).not.toBeNull();
    const url = await esperaRedirect(finalizarJogo(s.fut.id, jogo.id));
    expect(url).toBe(`/fut/${s.fut.id}/sumula?erro=jogo-nao-esta-aberto`);
  });
});

describe("delegarSumula e revogarSumula", () => {
  it("só alvo com conta ativa e presença no fut recebe a súmula", async () => {
    const s = await montarSumula();
    const semPresenca = await criarJogadorComConta();
    const semConta = await criarJogador();
    await confirmarPresenca(s.fut, semConta, { minutosAtras: 20 });
    const elegivel = await criarJogadorComConta();
    await confirmarPresenca(s.fut, elegivel.jogador, { minutosAtras: 10 });

    const form = (playerId: number) => {
      const f = new FormData();
      f.set("playerId", String(playerId));
      return f;
    };

    expect(await esperaRedirect(delegarSumula(s.fut.id, form(semPresenca.jogador.id)))).toBe(
      `/fut/${s.fut.id}/sumula?erro=operador-invalido`,
    );
    expect(await esperaRedirect(delegarSumula(s.fut.id, form(semConta.id)))).toBe(
      `/fut/${s.fut.id}/sumula?erro=operador-invalido`,
    );

    await delegarSumula(s.fut.id, form(elegivel.jogador.id));
    const linhas = await db
      .select()
      .from(sumulaOperadores)
      .where(eq(sumulaOperadores.matchDayId, s.fut.id));
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({
      playerId: elegivel.jogador.id,
      createdByPlayerId: s.admin.id,
    });
  });

  it("delegado não delega: o guard é o de admin do fut", async () => {
    const s = await montarSumula();
    const delegado = await criarDelegado(s.fut);
    const outro = await criarJogadorComConta();
    await confirmarPresenca(s.fut, outro.jogador, { minutosAtras: 5 });
    await logarComo(delegado.conta);

    const form = new FormData();
    form.set("playerId", String(outro.jogador.id));
    await esperaNotFound(delegarSumula(s.fut.id, form));
  });

  it("revogar derruba o acesso na hora", async () => {
    const s = await montarSumula();
    const delegado = await criarDelegado(s.fut);
    const jogo = await abrirJogo(s);

    await revogarSumula(s.fut.id, delegado.jogador.id);

    await logarComo(delegado.conta);
    await esperaNotFound(lancarGol(s.fut.id, jogo.id, formDeGol("A", s.ladoA[0].id)));
  });
});

describe("encerramento do fut com súmula", () => {
  it("jogo aberto trava o encerramento; finalizado, libera", async () => {
    const s = await montarSumula();
    const jogo = await abrirJogo(s);

    const url = await esperaRedirect(confirmarEncerramento(s.fut.id));
    expect(url).toBe(`/fut/${s.fut.id}/gerenciar/encerrar?erro=jogo-em-andamento`);
    const [aindaAberto] = await db.select().from(matchDays).where(eq(matchDays.id, s.fut.id));
    expect(aindaAberto.status).toBe("teams_drawn");

    await finalizarJogo(s.fut.id, jogo.id);
    await esperaRedirect(confirmarEncerramento(s.fut.id));
    const [encerrado] = await db.select().from(matchDays).where(eq(matchDays.id, s.fut.id));
    expect(encerrado.status).toBe("finished");
  });
});

/**
 * O gol do /gerenciar não passa pelo painel — nem para listar, nem para
 * desfazer. É a trava do bug de placar: `addGoal` insere sem tocar em
 * `games.score*` e aceita quantidade até 20, então um Desfazer na súmula
 * decrementaria o que aquele gol nunca somou.
 */
describe("fronteira com o addGoal do /gerenciar", () => {
  const formDeAddGoal = (playerId: number, quantity: number) => {
    const f = new FormData();
    f.set("playerId", String(playerId));
    f.set("quantity", String(quantity));
    return f;
  };

  it("gol do /gerenciar num jogo aberto não é desfazível pela súmula", async () => {
    const s = await montarSumula();
    const jogo = await abrirJogo(s);
    await lancarGol(s.fut.id, jogo.id, formDeGol("A", s.ladoA[0].id));
    await lancarGol(s.fut.id, jogo.id, formDeGol("A", s.ladoA[1].id));

    // O admin edita pelo /gerenciar durante o jogo aberto — permitido de
    // propósito, e o placar NÃO sobe por isso.
    await addGoal(s.fut.id, jogo.id, formDeAddGoal(s.ladoA[0].id, 3));
    expect(await jogoDoBanco(jogo.id)).toMatchObject({ scoreA: 2 });

    const gols = await golsDoJogo(jogo.id);
    const doGerenciar = gols[gols.length - 1];
    expect(doGerenciar).toMatchObject({ quantity: 3, somadoNoPlacar: false });

    const url = await esperaRedirect(desfazerLancamento(s.fut.id, doGerenciar.id));

    expect(url).toBe(`/fut/${s.fut.id}/sumula?erro=dados-invalidos`);
    expect(await jogoDoBanco(jogo.id)).toMatchObject({ scoreA: 2 });
    expect((await golsDoJogo(jogo.id))[gols.length - 1].desfeitoEm).toBeNull();
  });

  it("e não entra na conta de 'último do lado' do delegado", async () => {
    const s = await montarSumula();
    const delegado = await criarDelegado(s.fut);
    const jogo = await abrirJogo(s);
    await lancarGol(s.fut.id, jogo.id, formDeGol("A", s.ladoA[0].id));
    await addGoal(s.fut.id, jogo.id, formDeAddGoal(s.ladoA[1].id, 1));

    // O gol do /gerenciar é o mais recente do lado A, mas está fora do
    // universo da súmula — o lançamento anterior continua sendo "o último".
    await logarComo(delegado.conta);
    const [daSumula] = await golsDoJogo(jogo.id);
    await desfazerLancamento(s.fut.id, daSumula.id);

    expect(await jogoDoBanco(jogo.id)).toMatchObject({ scoreA: 0 });
  });
});

/**
 * Trocar de lado no meio do jogo. O que estes testes protegem é a divisão de
 * trabalho entre as três escritas: `game_players` responde pelo lado em que a
 * pessoa TERMINOU (e com ele V/E/D e avaliação), `team_players` pelo próximo
 * jogo, `trocas_de_lado` pela auditoria — e os gols já lançados por ninguém,
 * porque o lado deles é o do momento em que saíram.
 */
describe("trocarDeLado", () => {
  it("move a escalação, o colete e grava o log no mesmo commit", async () => {
    const s = await montarSumula();
    const jogo = await abrirJogo(s);
    const trocado = s.ladoA[0];

    await trocarDeLado(s.fut.id, jogo.id, trocado.id);

    expect(await ladoNoJogo(jogo.id, trocado.id)).toBe("B");
    expect(await timeDoJogador(s.fut.id, trocado.id)).toBe(s.timeBId);
    const trocas = await trocasDoJogo(jogo.id);
    expect(trocas).toHaveLength(1);
    expect(trocas[0]).toMatchObject({
      playerId: trocado.id,
      deLado: "A",
      paraLado: "B",
      createdByPlayerId: s.admin.id,
    });
  });

  it("depois da troca, o gol sai pelo lado novo e o antigo é recusado", async () => {
    const s = await montarSumula();
    const jogo = await abrirJogo(s);
    const trocado = s.ladoA[0];
    // Um gol ANTES da troca: ele é do lado A e assim tem que ficar.
    await lancarGol(s.fut.id, jogo.id, formDeGol("A", trocado.id));

    await trocarDeLado(s.fut.id, jogo.id, trocado.id);
    await lancarGol(s.fut.id, jogo.id, formDeGol("B", trocado.id));
    const url = await esperaRedirect(
      lancarGol(s.fut.id, jogo.id, formDeGol("A", trocado.id)),
    );

    expect(url).toBe(`/fut/${s.fut.id}/sumula?erro=artilheiro-fora-do-jogo`);
    // 1×1: o gol de antes continua do A, o de depois é do B, e o recusado não
    // mexeu em placar nenhum.
    expect(await jogoDoBanco(jogo.id)).toMatchObject({ scoreA: 1, scoreB: 1 });
    expect((await golsDoJogo(jogo.id)).map((g) => g.side)).toEqual(["A", "B"]);
  });

  it("trocar de volta é outra troca — as duas linhas ficam", async () => {
    const s = await montarSumula();
    const jogo = await abrirJogo(s);
    const trocado = s.ladoA[0];

    await trocarDeLado(s.fut.id, jogo.id, trocado.id);
    await trocarDeLado(s.fut.id, jogo.id, trocado.id);

    expect(await ladoNoJogo(jogo.id, trocado.id)).toBe("A");
    expect(await timeDoJogador(s.fut.id, trocado.id)).toBe(s.timeAId);
    expect((await trocasDoJogo(jogo.id)).map((t) => `${t.deLado}${t.paraLado}`)).toEqual([
      "AB",
      "BA",
    ]);
  });

  it("o próximo jogo nasce com o jogador no time novo", async () => {
    const s = await montarSumula();
    const primeiro = await abrirJogo(s);
    const trocado = s.ladoA[0];
    await trocarDeLado(s.fut.id, primeiro.id, trocado.id);
    await finalizarJogo(s.fut.id, primeiro.id);

    await iniciarJogo(s.fut.id, formDeTimes(s.timeAId, s.timeBId));

    const [, segundo] = await db
      .select()
      .from(games)
      .where(eq(games.matchDayId, s.fut.id))
      .orderBy(asc(games.id));
    expect(await ladoNoJogo(segundo.id, trocado.id)).toBe("B");
    // E o colete não some de ninguém: o snapshot continua com os quatro.
    expect(
      await db.select().from(gamePlayers).where(eq(gamePlayers.gameId, segundo.id)),
    ).toHaveLength(4);
  });

  it("delegado troca; quem não opera cai no 404 do guard", async () => {
    const s = await montarSumula();
    const delegado = await criarDelegado(s.fut);
    const jogo = await abrirJogo(s);

    await logarComo(delegado.conta);
    await trocarDeLado(s.fut.id, jogo.id, s.ladoA[0].id);
    expect(await ladoNoJogo(jogo.id, s.ladoA[0].id)).toBe("B");

    const { conta } = await criarJogadorComConta();
    await logarComo(conta);
    await esperaNotFound(trocarDeLado(s.fut.id, jogo.id, s.ladoA[1].id));
    expect(await ladoNoJogo(jogo.id, s.ladoA[1].id)).toBe("A");
  });

  it("não esvazia um lado — a mesma regra que o encerramento cobra depois", async () => {
    const s = await montarSumula();
    const jogo = await abrirJogo(s);
    await trocarDeLado(s.fut.id, jogo.id, s.ladoA[0].id);

    const url = await esperaRedirect(trocarDeLado(s.fut.id, jogo.id, s.ladoA[1].id));

    expect(url).toBe(`/fut/${s.fut.id}/sumula?erro=jogo-sem-time`);
    expect(await ladoNoJogo(jogo.id, s.ladoA[1].id)).toBe("A");
    expect(await trocasDoJogo(jogo.id)).toHaveLength(1);
  });

  it("recusa quem não está na escalação e o jogo já finalizado", async () => {
    const s = await montarSumula();
    const jogo = await abrirJogo(s);
    const forasteiro = await criarJogador();

    expect(await esperaRedirect(trocarDeLado(s.fut.id, jogo.id, forasteiro.id))).toBe(
      `/fut/${s.fut.id}/sumula?erro=jogador-fora-do-jogo`,
    );

    await finalizarJogo(s.fut.id, jogo.id);
    expect(await esperaRedirect(trocarDeLado(s.fut.id, jogo.id, s.ladoA[0].id))).toBe(
      `/fut/${s.fut.id}/sumula?erro=jogo-nao-esta-aberto`,
    );
    expect(await trocasDoJogo(jogo.id)).toHaveLength(0);
    expect(await ladoNoJogo(jogo.id, s.ladoA[0].id)).toBe("A");
  });

  // O mesmo desenho do "escopo por fut" mais abaixo: o fut alheio nasce
  // primeiro, e o montarSumula seguinte já deixa o admin do MEU fut logado.
  it("operador de um fut não troca ninguém no jogo de outro", async () => {
    const alheio = await montarSumula();
    const jogoAlheio = await abrirJogo(alheio);

    const meu = await montarSumula();
    await abrirJogo(meu);

    const url = await esperaRedirect(
      trocarDeLado(meu.fut.id, jogoAlheio.id, alheio.ladoA[0].id),
    );

    expect(url).toBe(`/fut/${meu.fut.id}/sumula?erro=jogo-nao-esta-aberto`);
    expect(await ladoNoJogo(jogoAlheio.id, alheio.ladoA[0].id)).toBe("A");
    expect(await trocasDoJogo(jogoAlheio.id)).toHaveLength(0);
  });

  it("fut encerrado recusa", async () => {
    const s = await montarSumula();
    const jogo = await abrirJogo(s);
    await db
      .update(matchDays)
      .set({ status: "finished", finishedAt: sql`now()` })
      .where(eq(matchDays.id, s.fut.id));

    const url = await esperaRedirect(trocarDeLado(s.fut.id, jogo.id, s.ladoA[0].id));

    expect(url).toBe(`/fut/${s.fut.id}/sumula?erro=fut-encerrado`);
    expect(await trocasDoJogo(jogo.id)).toHaveLength(0);
  });
});

/**
 * O que a troca significa DEPOIS do apito: quem trocou termina contado no time
 * em que acabou — no V/E/D e na lista de quem ele avalia —, enquanto os gols
 * dele continuam somando para ele, tenham saído por qual lado for.
 */
describe("a troca de lado nas estatísticas do fut encerrado", () => {
  it("V/E/D e companheiros seguem o lado final; a artilharia soma os dois", async () => {
    const s = await montarSumula({ comContas: true });
    const jogo = await abrirJogo(s);
    const trocado = s.ladoA[0];

    // Um gol para cada lado, do mesmo jogador, com a troca no meio. O B vence
    // por 2×1 — e o trocado termina no B.
    await lancarGol(s.fut.id, jogo.id, formDeGol("A", trocado.id));
    await trocarDeLado(s.fut.id, jogo.id, trocado.id);
    await lancarGol(s.fut.id, jogo.id, formDeGol("B", trocado.id));
    await lancarGol(s.fut.id, jogo.id, formDeGol("B", s.ladoB[0].id));
    await finalizarJogo(s.fut.id, jogo.id);
    await esperaRedirect(confirmarEncerramento(s.fut.id));

    expect(await jogoDoBanco(jogo.id)).toMatchObject({ scoreA: 1, scoreB: 2 });

    // Artilharia: os dois gols contam, sem olhar o lado de cada um.
    const artilharia = await getTopScorers();
    expect(artilharia.find((a) => a.playerId === trocado.id)).toMatchObject({ total: 2 });

    // V/E/D: venceu, porque terminou no B. Quem ficou no A, perdeu.
    const records = await getPlayerRecords();
    expect(records.find((r) => r.playerId === trocado.id)).toMatchObject({
      wins: 1,
      losses: 0,
      gamesPlayed: 1,
    });
    expect(records.find((r) => r.playerId === s.ladoA[1].id)).toMatchObject({
      wins: 0,
      losses: 1,
    });

    // Avaliação: os companheiros são os do B, e quem ficou no A não está lá.
    const companheiros = companheirosPorJogador(await getEscalacaoDoFut(db, s.fut.id));
    expect([...(companheiros.get(trocado.id) ?? [])].sort()).toEqual(
      s.ladoB.map((p) => p.id).sort(),
    );
    // E o inverso: o lado B agora enxerga quem chegou.
    expect(companheiros.get(s.ladoB[0].id)).toContain(trocado.id);
    expect(companheiros.get(s.ladoA[1].id)).not.toContain(trocado.id);
  });
});

describe("escopo por fut", () => {
  it("operador de um fut não escreve no jogo de outro", async () => {
    const alheio = await montarSumula();
    const jogoAlheio = await abrirJogo(alheio);
    await lancarGol(alheio.fut.id, jogoAlheio.id, formDeGol("A", alheio.ladoA[0].id));
    const [golAlheio] = await golsDoJogo(jogoAlheio.id);

    // Agora um fut totalmente separado, com outro admin logado.
    const meu = await montarSumula();
    await abrirJogo(meu);

    // Cada action recebe o id do fut que o operador administra e o id de um
    // objeto do OUTRO fut — é o predicado de escopo que tem que recusar.
    await esperaRedirect(lancarGol(meu.fut.id, jogoAlheio.id, formDeGol("A")));
    await esperaRedirect(finalizarJogo(meu.fut.id, jogoAlheio.id));
    await esperaRedirect(desfazerLancamento(meu.fut.id, golAlheio.id));

    expect(await jogoDoBanco(jogoAlheio.id)).toMatchObject({
      scoreA: 1,
      scoreB: 0,
      finishedAt: null,
    });
    expect((await golsDoJogo(jogoAlheio.id))[0].desfeitoEm).toBeNull();
  });
});

describe("o guard da súmula", () => {
  it("sem sessão manda para o login", async () => {
    const s = await montarSumula();
    deslogar();

    const url = await esperaRedirect(iniciarJogo(s.fut.id, formDeTimes(s.timeAId, s.timeBId)));

    expect(url).toBe("/login");
  });

  it("fut inexistente dá o mesmo 404 de fut alheio", async () => {
    const s = await montarSumula();

    await esperaNotFound(finalizarJogo(s.fut.id + 10_000, 1));
  });

  it("em fut de grupo, o admin do grupo opera sem delegação", async () => {
    const s = await montarSumula();
    const groupId = (await criarGrupo()).id;
    await db.update(matchDays).set({ groupId }).where(eq(matchDays.id, s.fut.id));

    const doGrupo = await criarJogadorComConta();
    await entrarNoGrupo(groupId, doGrupo.jogador, "admin");
    await logarComo(doGrupo.conta);

    const jogo = await abrirJogo(s);

    expect(jogo.startedAt).not.toBeNull();
    expect(
      await db
        .select()
        .from(sumulaOperadores)
        .where(eq(sumulaOperadores.matchDayId, s.fut.id)),
    ).toHaveLength(0);
  });

  it("organizador e membro do grupo continuam de fora", async () => {
    const s = await montarSumula();
    const groupId = (await criarGrupo()).id;
    await db.update(matchDays).set({ groupId }).where(eq(matchDays.id, s.fut.id));

    for (const papel of ["organizer", "member"] as const) {
      const pessoa = await criarJogadorComConta();
      await entrarNoGrupo(groupId, pessoa.jogador, papel);
      await logarComo(pessoa.conta);
      await esperaNotFound(iniciarJogo(s.fut.id, formDeTimes(s.timeAId, s.timeBId)));
    }
  });

  // A delegação segue a lista: sair do fut derruba a súmula na hora, sem
  // ninguém precisar lembrar de revogar.
  it("delegado que sai da lista perde a súmula", async () => {
    const s = await montarSumula();
    const delegado = await criarDelegado(s.fut);
    const jogo = await abrirJogo(s);
    await logarComo(delegado.conta);
    await lancarGol(s.fut.id, jogo.id, formDeGol("A", s.ladoA[0].id));

    await db
      .update(attendances)
      .set({ status: "out" })
      .where(eq(attendances.playerId, delegado.jogador.id));

    await esperaNotFound(lancarGol(s.fut.id, jogo.id, formDeGol("A", s.ladoA[1].id)));
    expect(await jogoDoBanco(jogo.id)).toMatchObject({ scoreA: 1 });
  });

  // Conta desativada nem chega à checagem de delegação: a própria sessão para
  // de valer. O `users.active` do guard é cinto e suspensório — quem derruba
  // este caso é o getSession, e é ele que o teste documenta.
  it("delegado com conta desativada não passa nem da sessão", async () => {
    const s = await montarSumula();
    const delegado = await criarDelegado(s.fut);
    const jogo = await abrirJogo(s);
    await logarComo(delegado.conta);

    await db.update(users).set({ active: false }).where(eq(users.id, delegado.conta.id));

    const url = await esperaRedirect(lancarGol(s.fut.id, jogo.id, formDeGol("A", s.ladoA[0].id)));
    expect(url).toBe("/login");
  });
});

describe("artilharia com a súmula", () => {
  it("gol sem autor e gol desfeito ficam fora; o resto conta", async () => {
    const s = await montarSumula({ comContas: true });
    const jogo = await abrirJogo(s);
    const artilheiro = s.ladoA[0];
    await lancarGol(s.fut.id, jogo.id, formDeGol("A", artilheiro.id));
    await lancarGol(s.fut.id, jogo.id, formDeGol("A", artilheiro.id));
    await lancarGol(s.fut.id, jogo.id, formDeGol("B"));
    await lancarGol(s.fut.id, jogo.id, formDeGol("B", s.ladoB[0].id));
    const gols = await golsDoJogo(jogo.id);
    await desfazerLancamento(s.fut.id, gols[3].id);
    await finalizarJogo(s.fut.id, jogo.id);
    await esperaRedirect(confirmarEncerramento(s.fut.id));

    const artilharia = await getTopScorers();

    // 2×1 no placar (o gol do B ficou sem autor e o do ladoB[0] foi desfeito);
    // na artilharia, só o artilheiro aparece.
    expect(await jogoDoBanco(jogo.id)).toMatchObject({ scoreA: 2, scoreB: 1 });
    expect(artilharia).toHaveLength(1);
    expect(artilharia[0]).toMatchObject({ playerId: artilheiro.id, total: 2 });
  });
});
