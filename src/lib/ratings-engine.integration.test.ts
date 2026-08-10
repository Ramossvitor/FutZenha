// Ciclo de avaliação e encerramento contra o banco de verdade: abrir rodada,
// enviar notas, fechar com replay, e as faltas automáticas do encerramento.
// A aritmética da nota já está travada em skill.test.ts — aqui o alvo é a
// composição com o Postgres e com as actions.

import { and, eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { enviarAvaliacoes } from "@/app/avaliar/[id]/actions";
import { confirmarEncerramento } from "@/app/pelada/[id]/gerenciar/encerrar/actions";
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
  type Game,
  type MatchDay,
  type Player,
} from "@/db/schema";
import { quemViraFalta } from "@/lib/encerramento";
import { getCompanheiros } from "@/lib/ratings";
import { abrirRodada, fecharRodada } from "@/lib/ratings-engine";
import { getAttendanceStats } from "@/lib/stats";
import {
  confirmarPresenca,
  criarJogador,
  criarJogadorComConta,
  criarPelada,
  logarComo,
} from "@/test/fixtures";
import { esperaRedirect } from "@/test/navigation-fake";

let sequenciaDeTimes = 0;

async function criarJogo(pelada: MatchDay, ladoA: Player[], ladoB: Player[]): Promise<Game> {
  sequenciaDeTimes += 1;
  const [timeA] = await db
    .insert(teams)
    .values({ matchDayId: pelada.id, name: `Time ${sequenciaDeTimes}A`, sortOrder: 0 })
    .returning();
  const [timeB] = await db
    .insert(teams)
    .values({ matchDayId: pelada.id, name: `Time ${sequenciaDeTimes}B`, sortOrder: 1 })
    .returning();
  const [jogo] = await db
    .insert(games)
    .values({ matchDayId: pelada.id, teamAId: timeA.id, teamBId: timeB.id })
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

async function rodadaDaPelada(pelada: MatchDay) {
  const [rodada] = await db
    .select()
    .from(ratingRounds)
    .where(eq(ratingRounds.matchDayId, pelada.id));
  return rodada;
}

async function notaDoJogador(jogador: Player): Promise<number> {
  const [linha] = await db
    .select({ skill: players.skill })
    .from(players)
    .where(eq(players.id, jogador.id));
  return linha.skill;
}

async function statusDaPresenca(pelada: MatchDay, jogador: Player): Promise<string> {
  const [linha] = await db
    .select({ status: attendances.status })
    .from(attendances)
    .where(and(eq(attendances.matchDayId, pelada.id), eq(attendances.playerId, jogador.id)));
  return linha.status;
}

/**
 * A prévia "vão contar falta" da tela de encerrar. Só o carregamento é daqui —
 * a REGRA sai do quemViraFalta, o mesmo que encerrar/page.tsx chama. Copiar a
 * regra para cá faria este teste comparar a cópia com o servidor, e a prévia de
 * verdade poderia derivar com o teste verde.
 */
async function previaViraFalta(pelada: MatchDay): Promise<number[]> {
  const jogosDaPelada = await db
    .select({ id: games.id })
    .from(games)
    .where(eq(games.matchDayId, pelada.id));

  const confirmados = await db
    .select({ playerId: attendances.playerId })
    .from(attendances)
    .where(and(eq(attendances.matchDayId, pelada.id), eq(attendances.status, "in")));
  const escalacao =
    jogosDaPelada.length === 0
      ? []
      : await db
          .select({ playerId: gamePlayers.playerId })
          .from(gamePlayers)
          .where(
            inArray(
              gamePlayers.gameId,
              jogosDaPelada.map((g) => g.id),
            ),
          );

  return quemViraFalta({
    temJogo: jogosDaPelada.length > 0,
    confirmados: confirmados.map((a) => a.playerId),
    escalados: escalacao.map((e) => e.playerId),
  }).sort((a, b) => a - b);
}

describe("abrirRodada", () => {
  it("cria a rodada com os raters elegíveis e notifica cada um", async () => {
    const pelada = await criarPelada();
    const timeA = await criarTrioComConta();
    const timeB = await criarTrioComConta();
    await criarJogo(pelada, timeA.jogadores, timeB.jogadores);

    const rodadaId = await abrirRodada(db, pelada.id);
    expect(rodadaId).not.toBeNull();

    const rodada = await rodadaDaPelada(pelada);
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

  it("abrir duas vezes na mesma pelada não duplica rodada, raters nem avisos", async () => {
    const pelada = await criarPelada();
    const timeA = await criarTrioComConta();
    const timeB = await criarTrioComConta();
    await criarJogo(pelada, timeA.jogadores, timeB.jogadores);

    const primeira = await abrirRodada(db, pelada.id);
    const segunda = await abrirRodada(db, pelada.id);
    expect(primeira).not.toBeNull();
    expect(segunda).toBeNull();

    const rodadas = await db
      .select()
      .from(ratingRounds)
      .where(eq(ratingRounds.matchDayId, pelada.id));
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
    const pelada = await criarPelada();
    const timeA = await criarTrioComConta();
    const timeB = await criarTrioComConta();
    await criarJogo(pelada, timeA.jogadores, timeB.jogadores);
    const rodadaId = (await abrirRodada(db, pelada.id))!;

    await avaliarTrio(rodadaId, timeA.jogadores, 5);
    await avaliarTrio(rodadaId, timeB.jogadores, 1);

    const fechou = await db.transaction((tx) => fecharRodada(tx, rodadaId, "admin"));
    expect(fechou).toBe(true);

    const rodada = await rodadaDaPelada(pelada);
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
    const pelada = await criarPelada();
    const trio = await criarTrioComConta();
    const semConta = [await criarJogador(), await criarJogador(), await criarJogador()];
    await criarJogo(pelada, trio.jogadores, semConta);
    const rodadaId = (await abrirRodada(db, pelada.id))!;
    return { pelada, trio, rodadaId };
  }

  it("com sessão logada grava as notas e marca o envio", async () => {
    const { pelada, trio, rodadaId } = await montarRodadaComTrio();

    await logarComo(trio.contas[0]);
    const companheiros = await getCompanheiros(pelada.id, trio.jogadores[0].id);
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
    expect((await rodadaDaPelada(pelada)).status).toBe("open");
  });

  it("quando o último avaliador envia, a rodada fecha e as notas saem", async () => {
    const { pelada, trio, rodadaId } = await montarRodadaComTrio();

    for (const [i, conta] of trio.contas.entries()) {
      await logarComo(conta);
      const companheiros = await getCompanheiros(pelada.id, trio.jogadores[i].id);
      const resultado = await enviarAvaliacoes(rodadaId, {}, formularioDeNotas(companheiros, 4));
      expect(resultado).toEqual({ success: true });
    }

    const rodada = await rodadaDaPelada(pelada);
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

describe("confirmarEncerramento", () => {
  it("admin da pelada encerra e abre a rodada de avaliação junto", async () => {
    const admin = await criarJogadorComConta();
    const pelada = await criarPelada({ createdByPlayerId: admin.jogador.id });
    const timeA = await criarTrioComConta();
    const timeB = await criarTrioComConta();
    await criarJogo(pelada, timeA.jogadores, timeB.jogadores);
    for (const [i, j] of [...timeA.jogadores, ...timeB.jogadores].entries()) {
      await confirmarPresenca(pelada, j, { minutosAtras: 60 - i * 5 });
    }

    await logarComo(admin.conta);
    const destino = await esperaRedirect(confirmarEncerramento(pelada.id));
    expect(destino).toBe(`/pelada/${pelada.id}/gerenciar`);

    const [encerrada] = await db.select().from(matchDays).where(eq(matchDays.id, pelada.id));
    expect(encerrada.status).toBe("finished");
    expect(encerrada.finishedAt).not.toBeNull();

    const rodada = await rodadaDaPelada(pelada);
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
    const pelada = await criarPelada({ createdByPlayerId: admin.jogador.id });
    const escalado1 = await criarJogador();
    const escalado2 = await criarJogador();
    const soNoSegundoJogo = await criarJogador();
    const sumido = await criarJogador();
    const espera = await criarJogador();
    const fora = await criarJogador();

    await criarJogo(pelada, [escalado1], [escalado2]);
    await criarJogo(pelada, [soNoSegundoJogo], [escalado1]);

    await confirmarPresenca(pelada, escalado1, { minutosAtras: 60 });
    await confirmarPresenca(pelada, escalado2, { minutosAtras: 50 });
    await confirmarPresenca(pelada, soNoSegundoJogo, { minutosAtras: 40 });
    await confirmarPresenca(pelada, sumido, { minutosAtras: 30 });
    await confirmarPresenca(pelada, espera, { status: "waitlist", minutosAtras: 20 });
    await confirmarPresenca(pelada, fora, { status: "out" });

    await logarComo(admin.conta);
    await esperaRedirect(confirmarEncerramento(pelada.id));

    expect(await statusDaPresenca(pelada, sumido)).toBe("no_show");
    expect(await statusDaPresenca(pelada, escalado1)).toBe("in");
    expect(await statusDaPresenca(pelada, escalado2)).toBe("in");
    // Entrar em qualquer UM dos jogos basta.
    expect(await statusDaPresenca(pelada, soNoSegundoJogo)).toBe("in");
    expect(await statusDaPresenca(pelada, espera)).toBe("waitlist");
    expect(await statusDaPresenca(pelada, fora)).toBe("out");
  });

  it("pelada com confirmados mas sem jogo lançado encerra sem marcar falta em ninguém", async () => {
    const admin = await criarJogadorComConta();
    const pelada = await criarPelada({ createdByPlayerId: admin.jogador.id });
    const confirmado1 = await criarJogador();
    const confirmado2 = await criarJogador();
    await confirmarPresenca(pelada, confirmado1, { minutosAtras: 20 });
    await confirmarPresenca(pelada, confirmado2, { minutosAtras: 10 });

    await logarComo(admin.conta);
    await esperaRedirect(confirmarEncerramento(pelada.id));

    const [encerrada] = await db.select().from(matchDays).where(eq(matchDays.id, pelada.id));
    expect(encerrada.status).toBe("finished");
    expect(await statusDaPresenca(pelada, confirmado1)).toBe("in");
    expect(await statusDaPresenca(pelada, confirmado2)).toBe("in");
    // Sem escalação também não há o que avaliar.
    expect(await rodadaDaPelada(pelada)).toBeUndefined();
  });

  it("escalação em outra pelada não conta: o jogador vira falta nesta", async () => {
    const admin = await criarJogadorComConta();
    const outraPelada = await criarPelada({ date: "2026-08-05" });
    const viajante = await criarJogador();
    const rival = await criarJogador();
    await criarJogo(outraPelada, [viajante], [rival]);
    await confirmarPresenca(outraPelada, viajante, { minutosAtras: 90 });

    const pelada = await criarPelada({ createdByPlayerId: admin.jogador.id });
    const escaladoA = await criarJogador();
    const escaladoB = await criarJogador();
    await criarJogo(pelada, [escaladoA], [escaladoB]);
    await confirmarPresenca(pelada, viajante, { minutosAtras: 30 });
    await confirmarPresenca(pelada, escaladoA, { minutosAtras: 20 });
    await confirmarPresenca(pelada, escaladoB, { minutosAtras: 10 });

    await logarComo(admin.conta);
    await esperaRedirect(confirmarEncerramento(pelada.id));

    expect(await statusDaPresenca(pelada, viajante)).toBe("no_show");
    // A presença dele na pelada em que jogou fica intacta.
    expect(await statusDaPresenca(outraPelada, viajante)).toBe("in");
  });

  it("a prévia da tela de encerrar bate com o que o encerramento grava", async () => {
    const admin = await criarJogadorComConta();
    const pelada = await criarPelada({ createdByPlayerId: admin.jogador.id });
    const emCampo1 = await criarJogador();
    const emCampo2 = await criarJogador();
    const arquibancada1 = await criarJogador();
    const arquibancada2 = await criarJogador();
    const espera = await criarJogador();

    await criarJogo(pelada, [emCampo1], [emCampo2]);
    await confirmarPresenca(pelada, emCampo1, { minutosAtras: 50 });
    await confirmarPresenca(pelada, emCampo2, { minutosAtras: 40 });
    await confirmarPresenca(pelada, arquibancada1, { minutosAtras: 30 });
    await confirmarPresenca(pelada, arquibancada2, { minutosAtras: 20 });
    await confirmarPresenca(pelada, espera, { status: "waitlist", minutosAtras: 10 });

    const previa = await previaViraFalta(pelada);
    expect(previa).toEqual([arquibancada1.id, arquibancada2.id].sort((a, b) => a - b));

    await logarComo(admin.conta);
    await esperaRedirect(confirmarEncerramento(pelada.id));

    const faltas = await db
      .select({ playerId: attendances.playerId })
      .from(attendances)
      .where(and(eq(attendances.matchDayId, pelada.id), eq(attendances.status, "no_show")));
    expect(faltas.map((f) => f.playerId).sort((a, b) => a - b)).toEqual(previa);
  });
});

describe("getAttendanceStats", () => {
  it("só pelada encerrada entra no denominador; espera e falta não contam presença", async () => {
    const encerrada = await criarPelada({ status: "finished", date: "2026-08-05" });
    const futura = await criarPelada();
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
