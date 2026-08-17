// Ciclo de avaliação e encerramento contra o banco de verdade: abrir rodada,
// enviar notas, fechar com replay, e as faltas automáticas do encerramento.
// A aritmética da nota já está travada em skill.test.ts — aqui o alvo é a
// composição com o Postgres e com as actions.

import { and, eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { enviarAvaliacoes } from "@/app/avaliar/[id]/actions";
import { confirmarEncerramento } from "@/app/fut/[id]/gerenciar/encerrar/actions";
import { db } from "@/db";
import {
  attendances,
  gamePlayers,
  games,
  matchDays,
  notifications,
  players,
  ratingRoundRaters,
  ratingRounds,
  ratings,
  skillHistory,
  teams,
  users,
  type Game,
  type MatchDay,
  type Player,
} from "@/db/schema";
import { quemViraFalta } from "@/lib/encerramento";
import { getAvaliadoresDaRodada, getCompanheiros } from "@/lib/ratings";
import { abrirRodada, fecharRodada } from "@/lib/ratings-engine";
import { getAttendanceStats } from "@/lib/stats";
import {
  confirmarPresenca,
  criarJogador,
  criarJogadorComConta,
  criarFut,
  logarComo,
} from "@/test/fixtures";
import { esperaRedirect } from "@/test/navigation-fake";

let sequenciaDeTimes = 0;

async function criarJogo(fut: MatchDay, ladoA: Player[], ladoB: Player[]): Promise<Game> {
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
async function criarTrioComConta() {
  const primeiro = await criarJogadorComConta();
  const segundo = await criarJogadorComConta();
  const terceiro = await criarJogadorComConta();
  return {
    jogadores: [primeiro.jogador, segundo.jogador, terceiro.jogador],
    contas: [primeiro.conta, segundo.conta, terceiro.conta],
  };
}

/** Todos do trio dão a mesma nota aos outros dois, direto no banco. */
async function avaliarTrio(roundId: number, trio: Player[], stars: number): Promise<void> {
  const notas = [];
  for (const rater of trio) {
    for (const rated of trio) {
      if (rater.id !== rated.id) {
        notas.push({ roundId, raterPlayerId: rater.id, ratedPlayerId: rated.id, stars });
      }
    }
  }
  await db.insert(ratings).values(notas);
}

function formularioDeNotas(companheiros: { playerId: number }[], estrelas: number): FormData {
  const form = new FormData();
  for (const c of companheiros) form.set(`estrelas-${c.playerId}`, String(estrelas));
  return form;
}

async function rodadaDoFut(fut: MatchDay) {
  const [rodada] = await db
    .select()
    .from(ratingRounds)
    .where(eq(ratingRounds.matchDayId, fut.id));
  return rodada;
}

async function notaDoJogador(jogador: Player): Promise<number> {
  const [linha] = await db
    .select({ skill: players.skill })
    .from(players)
    .where(eq(players.id, jogador.id));
  return linha.skill;
}

async function statusDaPresenca(fut: MatchDay, jogador: Player): Promise<string> {
  const [linha] = await db
    .select({ status: attendances.status })
    .from(attendances)
    .where(and(eq(attendances.matchDayId, fut.id), eq(attendances.playerId, jogador.id)));
  return linha.status;
}

/**
 * A prévia "vão contar falta" da tela de encerrar. Só o carregamento é daqui —
 * a REGRA sai do quemViraFalta, o mesmo que encerrar/page.tsx chama. Copiar a
 * regra para cá faria este teste comparar a cópia com o servidor, e a prévia de
 * verdade poderia derivar com o teste verde.
 */
async function previaViraFalta(fut: MatchDay): Promise<number[]> {
  const jogosDoFut = await db
    .select({ id: games.id })
    .from(games)
    .where(eq(games.matchDayId, fut.id));

  const confirmados = await db
    .select({ playerId: attendances.playerId })
    .from(attendances)
    .where(and(eq(attendances.matchDayId, fut.id), eq(attendances.status, "in")));
  const escalacao =
    jogosDoFut.length === 0
      ? []
      : await db
          .select({ playerId: gamePlayers.playerId })
          .from(gamePlayers)
          .where(
            inArray(
              gamePlayers.gameId,
              jogosDoFut.map((g) => g.id),
            ),
          );

  return quemViraFalta({
    temJogo: jogosDoFut.length > 0,
    confirmados: confirmados.map((a) => a.playerId),
    escalados: escalacao.map((e) => e.playerId),
  }).sort((a, b) => a - b);
}

describe("abrirRodada", () => {
  it("cria a rodada com os raters elegíveis e notifica cada um", async () => {
    const fut = await criarFut();
    const timeA = await criarTrioComConta();
    const timeB = await criarTrioComConta();
    await criarJogo(fut, timeA.jogadores, timeB.jogadores);

    const rodadaId = await abrirRodada(db, fut.id);
    expect(rodadaId).not.toBeNull();

    const rodada = await rodadaDoFut(fut);
    expect(rodada.id).toBe(rodadaId);
    expect(rodada.status).toBe("open");

    const raters = await db
      .select()
      .from(ratingRoundRaters)
      .where(eq(ratingRoundRaters.roundId, rodada.id));
    const esperados = [...timeA.jogadores, ...timeB.jogadores].map((j) => j.id);
    expect(raters.map((r) => r.playerId).sort((a, b) => a - b)).toEqual(
      esperados.sort((a, b) => a - b),
    );
    expect(raters.every((r) => r.submittedAt === null)).toBe(true);

    const avisos = await db
      .select()
      .from(notifications)
      .where(eq(notifications.type, "rating_round_open"));
    expect(avisos).toHaveLength(6);
    expect(avisos.map((a) => a.href)).toContain(`/avaliar/${rodada.id}`);
  });

  it("abrir duas vezes no mesmo fut não duplica rodada, raters nem avisos", async () => {
    const fut = await criarFut();
    const timeA = await criarTrioComConta();
    const timeB = await criarTrioComConta();
    await criarJogo(fut, timeA.jogadores, timeB.jogadores);

    const primeira = await abrirRodada(db, fut.id);
    const segunda = await abrirRodada(db, fut.id);
    expect(primeira).not.toBeNull();
    expect(segunda).toBeNull();

    const rodadas = await db
      .select()
      .from(ratingRounds)
      .where(eq(ratingRounds.matchDayId, fut.id));
    expect(rodadas).toHaveLength(1);
    const raters = await db
      .select()
      .from(ratingRoundRaters)
      .where(eq(ratingRoundRaters.roundId, primeira!));
    expect(raters).toHaveLength(6);
    const avisos = await db
      .select()
      .from(notifications)
      .where(eq(notifications.type, "rating_round_open"));
    expect(avisos).toHaveLength(6);
  });

  it("fechar a rodada grava skill_history, move players.skill e notifica quem mudou", async () => {
    const fut = await criarFut();
    const timeA = await criarTrioComConta();
    const timeB = await criarTrioComConta();
    await criarJogo(fut, timeA.jogadores, timeB.jogadores);
    const rodadaId = (await abrirRodada(db, fut.id))!;

    await avaliarTrio(rodadaId, timeA.jogadores, 5);
    await avaliarTrio(rodadaId, timeB.jogadores, 1);

    const fechou = await db.transaction((tx) => fecharRodada(tx, rodadaId, "admin"));
    expect(fechou).toBe(true);

    const rodada = await rodadaDoFut(fut);
    expect(rodada.status).toBe("closed");
    expect(rodada.closeReason).toBe("admin");
    expect(rodada.closedAt).not.toBeNull();
    expect(rodada.reportDeadlineAt).not.toBeNull();

    // 5★ unânime: (2×5,0 + 10,0) / 3 → 6,7. 1★ unânime: (2×5,0 + 1,0) / 3 → 3,7.
    for (const j of timeA.jogadores) expect(await notaDoJogador(j)).toBe(6.7);
    for (const j of timeB.jogadores) expect(await notaDoJogador(j)).toBe(3.7);

    const historico = await db
      .select()
      .from(skillHistory)
      .where(eq(skillHistory.roundId, rodadaId));
    expect(historico).toHaveLength(6);
    const linhaDoA = historico.find((h) => h.playerId === timeA.jogadores[0].id);
    expect(linhaDoA).toMatchObject({
      skillBefore: 5,
      skillAfter: 6.7,
      ratingsCount: 2,
      averageReceived: 10,
    });

    const avisos = await db
      .select()
      .from(notifications)
      .where(eq(notifications.type, "skill_changed"));
    expect(avisos).toHaveLength(6);
    const avisoDoA = avisos.find((n) => n.playerId === timeA.jogadores[0].id);
    expect(avisoDoA?.title).toBe("Sua nota subiu!");
    expect(avisoDoA?.dedupeKey).toBe(`nota:rodada:${rodadaId}`);
  });
});

describe("enviarAvaliacoes", () => {
  async function montarRodadaComTrio() {
    const fut = await criarFut();
    const trio = await criarTrioComConta();
    const semConta = [await criarJogador(), await criarJogador(), await criarJogador()];
    await criarJogo(fut, trio.jogadores, semConta);
    const rodadaId = (await abrirRodada(db, fut.id))!;
    return { fut, trio, rodadaId };
  }

  it("com sessão logada grava as notas e marca o envio", async () => {
    const { fut, trio, rodadaId } = await montarRodadaComTrio();

    await logarComo(trio.contas[0]);
    const companheiros = await getCompanheiros(fut.id, trio.jogadores[0].id);
    expect(companheiros).toHaveLength(2);

    const resultado = await enviarAvaliacoes(rodadaId, {}, formularioDeNotas(companheiros, 4));
    expect(resultado).toEqual({ success: true });

    const notas = await db
      .select()
      .from(ratings)
      .where(eq(ratings.raterPlayerId, trio.jogadores[0].id));
    expect(notas).toHaveLength(2);
    expect(notas.every((n) => n.stars === 4)).toBe(true);

    const [rater] = await db
      .select()
      .from(ratingRoundRaters)
      .where(
        and(
          eq(ratingRoundRaters.roundId, rodadaId),
          eq(ratingRoundRaters.playerId, trio.jogadores[0].id),
        ),
      );
    expect(rater.submittedAt).not.toBeNull();

    // Faltam dois avaliadores: a rodada continua aberta.
    expect((await rodadaDoFut(fut)).status).toBe("open");
  });

  it("quando o último avaliador envia, a rodada fecha e as notas saem", async () => {
    const { fut, trio, rodadaId } = await montarRodadaComTrio();

    for (const [i, conta] of trio.contas.entries()) {
      await logarComo(conta);
      const companheiros = await getCompanheiros(fut.id, trio.jogadores[i].id);
      const resultado = await enviarAvaliacoes(rodadaId, {}, formularioDeNotas(companheiros, 4));
      expect(resultado).toEqual({ success: true });
    }

    const rodada = await rodadaDoFut(fut);
    expect(rodada.status).toBe("closed");
    expect(rodada.closeReason).toBe("todos_avaliaram");

    // Dois 4★ recebidos: média 7,75 → (2×5,0 + 7,75) / 3 → 5,9.
    for (const j of trio.jogadores) expect(await notaDoJogador(j)).toBe(5.9);
  });

  it("avaliador fora da lista de raters não consegue enviar", async () => {
    const { trio, rodadaId } = await montarRodadaComTrio();
    const intruso = await criarJogadorComConta();

    await logarComo(intruso.conta);
    const resultado = await enviarAvaliacoes(
      rodadaId,
      {},
      formularioDeNotas([{ playerId: trio.jogadores[0].id }], 5),
    );
    expect(resultado.error).toBe("Esta avaliação não está mais aberta para você.");

    const notas = await db
      .select()
      .from(ratings)
      .where(eq(ratings.raterPlayerId, intruso.jogador.id));
    expect(notas).toHaveLength(0);
  });
});

describe("getAvaliadoresDaRodada", () => {
  /** Trio com nome controlado, para poder asseverar a ordem alfabética. */
  async function montarRodadaNomeada() {
    const fut = await criarFut();
    const ana = await criarJogadorComConta({ name: "Ana" });
    const bia = await criarJogadorComConta({ name: "Bia" });
    const caio = await criarJogadorComConta({ name: "Caio" });
    const semConta = [await criarJogador(), await criarJogador(), await criarJogador()];
    await criarJogo(fut, [ana.jogador, bia.jogador, caio.jogador], semConta);
    const rodadaId = (await abrirRodada(db, fut.id))!;
    return { fut, ana, bia, caio, rodadaId };
  }

  it("rodada nova lista o roster inteiro como pendente, em ordem alfabética", async () => {
    const { rodadaId } = await montarRodadaNomeada();

    const avaliadores = await getAvaliadoresDaRodada(rodadaId);
    expect(avaliadores.map((a) => a.name)).toEqual(["Ana", "Bia", "Caio"]);
    expect(avaliadores.every((a) => !a.jaAvaliou)).toBe(true);
  });

  it("quem envia vira 'já avaliou' e desce para depois dos pendentes", async () => {
    const { fut, bia, rodadaId } = await montarRodadaNomeada();

    await logarComo(bia.conta);
    const companheiros = await getCompanheiros(fut.id, bia.jogador.id);
    expect(await enviarAvaliacoes(rodadaId, {}, formularioDeNotas(companheiros, 3))).toEqual({
      success: true,
    });

    // Pendentes primeiro (por nome), quem já avaliou depois — nunca na ordem de
    // envio, que o anonimato não entrega.
    const avaliadores = await getAvaliadoresDaRodada(rodadaId);
    expect(avaliadores.map((a) => [a.name, a.jaAvaliou])).toEqual([
      ["Ana", false],
      ["Caio", false],
      ["Bia", true],
    ]);
  });

  it("apelido vem junto, para a lista chamar cada um como o fut chama", async () => {
    const fut = await criarFut();
    const dono = await criarJogadorComConta({ name: "Eduardo", nickname: "Du" });
    const trio = await criarTrioComConta();
    await criarJogo(fut, [dono.jogador, ...trio.jogadores], [await criarJogador()]);
    const rodadaId = (await abrirRodada(db, fut.id))!;

    const avaliadores = await getAvaliadoresDaRodada(rodadaId);
    expect(avaliadores.find((a) => a.name === "Eduardo")?.nickname).toBe("Du");
  });

  it("conta desativada depois da abertura sai da lista", async () => {
    const { caio, rodadaId } = await montarRodadaNomeada();

    await db.update(users).set({ active: false }).where(eq(users.id, caio.conta.id));

    // Mesmo filtro do fecharSeTodosAvaliaram: o tamanho da lista é o denominador
    // real do "todos avaliaram", senão uma conta desligada travaria a rodada.
    const avaliadores = await getAvaliadoresDaRodada(rodadaId);
    expect(avaliadores.map((a) => a.name)).toEqual(["Ana", "Bia"]);
  });
});

describe("confirmarEncerramento", () => {
  it("admin do fut encerra e abre a rodada de avaliação junto", async () => {
    const admin = await criarJogadorComConta();
    const fut = await criarFut({ createdByPlayerId: admin.jogador.id });
    const timeA = await criarTrioComConta();
    const timeB = await criarTrioComConta();
    await criarJogo(fut, timeA.jogadores, timeB.jogadores);
    for (const [i, j] of [...timeA.jogadores, ...timeB.jogadores].entries()) {
      await confirmarPresenca(fut, j, { minutosAtras: 60 - i * 5 });
    }

    await logarComo(admin.conta);
    const destino = await esperaRedirect(confirmarEncerramento(fut.id));
    expect(destino).toBe(`/fut/${fut.id}/gerenciar`);

    const [encerrada] = await db.select().from(matchDays).where(eq(matchDays.id, fut.id));
    expect(encerrada.status).toBe("finished");
    expect(encerrada.finishedAt).not.toBeNull();

    const rodada = await rodadaDoFut(fut);
    expect(rodada.status).toBe("open");
    const raters = await db
      .select()
      .from(ratingRoundRaters)
      .where(eq(ratingRoundRaters.roundId, rodada.id));
    expect(raters).toHaveLength(6);
  });
});

describe("faltas automáticas no encerramento", () => {
  it("quem confirmou e não entrou em nenhum jogo vira falta; escalado, espera e fora ficam como estão", async () => {
    const admin = await criarJogadorComConta();
    const fut = await criarFut({ createdByPlayerId: admin.jogador.id });
    const escalado1 = await criarJogador();
    const escalado2 = await criarJogador();
    const soNoSegundoJogo = await criarJogador();
    const sumido = await criarJogador();
    const espera = await criarJogador();
    const fora = await criarJogador();

    await criarJogo(fut, [escalado1], [escalado2]);
    await criarJogo(fut, [soNoSegundoJogo], [escalado1]);

    await confirmarPresenca(fut, escalado1, { minutosAtras: 60 });
    await confirmarPresenca(fut, escalado2, { minutosAtras: 50 });
    await confirmarPresenca(fut, soNoSegundoJogo, { minutosAtras: 40 });
    await confirmarPresenca(fut, sumido, { minutosAtras: 30 });
    await confirmarPresenca(fut, espera, { status: "waitlist", minutosAtras: 20 });
    await confirmarPresenca(fut, fora, { status: "out" });

    await logarComo(admin.conta);
    await esperaRedirect(confirmarEncerramento(fut.id));

    expect(await statusDaPresenca(fut, sumido)).toBe("no_show");
    expect(await statusDaPresenca(fut, escalado1)).toBe("in");
    expect(await statusDaPresenca(fut, escalado2)).toBe("in");
    // Entrar em qualquer UM dos jogos basta.
    expect(await statusDaPresenca(fut, soNoSegundoJogo)).toBe("in");
    expect(await statusDaPresenca(fut, espera)).toBe("waitlist");
    expect(await statusDaPresenca(fut, fora)).toBe("out");
  });

  it("fut com confirmados mas sem jogo lançado encerra sem marcar falta em ninguém", async () => {
    const admin = await criarJogadorComConta();
    const fut = await criarFut({ createdByPlayerId: admin.jogador.id });
    const confirmado1 = await criarJogador();
    const confirmado2 = await criarJogador();
    await confirmarPresenca(fut, confirmado1, { minutosAtras: 20 });
    await confirmarPresenca(fut, confirmado2, { minutosAtras: 10 });

    await logarComo(admin.conta);
    await esperaRedirect(confirmarEncerramento(fut.id));

    const [encerrada] = await db.select().from(matchDays).where(eq(matchDays.id, fut.id));
    expect(encerrada.status).toBe("finished");
    expect(await statusDaPresenca(fut, confirmado1)).toBe("in");
    expect(await statusDaPresenca(fut, confirmado2)).toBe("in");
    // Sem escalação também não há o que avaliar.
    expect(await rodadaDoFut(fut)).toBeUndefined();
  });

  it("escalação em outro fut não conta: o jogador vira falta nesta", async () => {
    const admin = await criarJogadorComConta();
    const outroFut = await criarFut({ date: "2026-08-05" });
    const viajante = await criarJogador();
    const rival = await criarJogador();
    await criarJogo(outroFut, [viajante], [rival]);
    await confirmarPresenca(outroFut, viajante, { minutosAtras: 90 });

    const fut = await criarFut({ createdByPlayerId: admin.jogador.id });
    const escaladoA = await criarJogador();
    const escaladoB = await criarJogador();
    await criarJogo(fut, [escaladoA], [escaladoB]);
    await confirmarPresenca(fut, viajante, { minutosAtras: 30 });
    await confirmarPresenca(fut, escaladoA, { minutosAtras: 20 });
    await confirmarPresenca(fut, escaladoB, { minutosAtras: 10 });

    await logarComo(admin.conta);
    await esperaRedirect(confirmarEncerramento(fut.id));

    expect(await statusDaPresenca(fut, viajante)).toBe("no_show");
    // A presença dele no fut em que jogou fica intacta.
    expect(await statusDaPresenca(outroFut, viajante)).toBe("in");
  });

  it("a prévia da tela de encerrar bate com o que o encerramento grava", async () => {
    const admin = await criarJogadorComConta();
    const fut = await criarFut({ createdByPlayerId: admin.jogador.id });
    const emCampo1 = await criarJogador();
    const emCampo2 = await criarJogador();
    const arquibancada1 = await criarJogador();
    const arquibancada2 = await criarJogador();
    const espera = await criarJogador();

    await criarJogo(fut, [emCampo1], [emCampo2]);
    await confirmarPresenca(fut, emCampo1, { minutosAtras: 50 });
    await confirmarPresenca(fut, emCampo2, { minutosAtras: 40 });
    await confirmarPresenca(fut, arquibancada1, { minutosAtras: 30 });
    await confirmarPresenca(fut, arquibancada2, { minutosAtras: 20 });
    await confirmarPresenca(fut, espera, { status: "waitlist", minutosAtras: 10 });

    const previa = await previaViraFalta(fut);
    expect(previa).toEqual([arquibancada1.id, arquibancada2.id].sort((a, b) => a - b));

    await logarComo(admin.conta);
    await esperaRedirect(confirmarEncerramento(fut.id));

    const faltas = await db
      .select({ playerId: attendances.playerId })
      .from(attendances)
      .where(and(eq(attendances.matchDayId, fut.id), eq(attendances.status, "no_show")));
    expect(faltas.map((f) => f.playerId).sort((a, b) => a - b)).toEqual(previa);
  });
});

describe("getAttendanceStats", () => {
  it("só fut encerrado entra no denominador; espera e falta não contam presença", async () => {
    const encerrada = await criarFut({ status: "finished", date: "2026-08-05" });
    const futura = await criarFut();
    const assidua = await criarJogadorComConta();
    const faltosa = await criarJogadorComConta();
    const naEspera = await criarJogadorComConta();

    await confirmarPresenca(encerrada, assidua.jogador, { minutosAtras: 30 });
    await confirmarPresenca(encerrada, faltosa.jogador, { status: "no_show", minutosAtras: 20 });
    await confirmarPresenca(encerrada, naEspera.jogador, { status: "waitlist", minutosAtras: 10 });
    await confirmarPresenca(futura, assidua.jogador, { minutosAtras: 5 });

    const stats = await getAttendanceStats();
    expect(stats.totalDays).toBe(1);
    expect(stats.perPlayer).toEqual([
      expect.objectContaining({ playerId: assidua.jogador.id, attended: 1 }),
    ]);
  });
});
