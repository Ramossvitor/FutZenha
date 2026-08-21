// O ciclo do MVP contra o banco de verdade: o voto entrando pelo envio da
// avaliação (tudo-ou-nada), a apuração derivada no fechamento com o aviso ao
// eleito, e o ranking por grupo. A regra pura do desempate já está travada em
// mvp.test.ts — aqui o alvo é a composição com o Postgres e com as actions.

import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { enviarAvaliacoes } from "@/app/avaliar/[id]/actions";
import { db } from "@/db";
import {
  groups,
  notifications,
  ratingRoundRaters,
  ratings,
  users,
  type Player,
} from "@/db/schema";
import {
  getCandidatosMvp,
  getCompanheiros,
  getMvpDoFut,
} from "@/lib/ratings";
import { abrirRodada, fecharRodada } from "@/lib/ratings-engine";
import { getMvpRanking } from "@/lib/stats";
import { criarFut, criarJogador, criarJogadorComConta, logarComo } from "@/test/fixtures";
import { esperaRedirect } from "@/test/navigation-fake";
import { avaliarTrio, criarJogo, criarTrioComConta } from "@/test/fixtures-avaliacao";

/** Dois trios com conta, um de cada lado — todo mundo avalia e vota. */
async function montarFutCompleto() {
  const fut = await criarFut();
  const timeA = await criarTrioComConta();
  const timeB = await criarTrioComConta();
  await criarJogo(fut, timeA.jogadores, timeB.jogadores);
  const rodadaId = (await abrirRodada(db, fut.id))!.roundId;
  return { fut, timeA, timeB, rodadaId };
}

/** O formulário completo do envio: notas iguais para o lado + o voto de MVP. */
function formulario(
  companheiros: { playerId: number }[],
  meias: number,
  mvp?: number,
): FormData {
  const form = new FormData();
  for (const c of companheiros) form.set(`estrelas-${c.playerId}`, String(meias));
  if (mvp !== undefined) form.set("mvp", String(mvp));
  return form;
}

async function votoGravado(roundId: number, eleitor: Player): Promise<number | null> {
  const [linha] = await db
    .select({ mvpPlayerId: ratingRoundRaters.mvpPlayerId })
    .from(ratingRoundRaters)
    .where(
      and(eq(ratingRoundRaters.roundId, roundId), eq(ratingRoundRaters.playerId, eleitor.id)),
    );
  return linha.mvpPlayerId;
}

/** Grava votos direto no eleitorado congelado, para montar cenário de apuração. */
async function votar(roundId: number, votos: Array<[eleitor: Player, votado: Player]>) {
  for (const [eleitor, votado] of votos) {
    await db
      .update(ratingRoundRaters)
      .set({ mvpPlayerId: votado.id })
      .where(
        and(eq(ratingRoundRaters.roundId, roundId), eq(ratingRoundRaters.playerId, eleitor.id)),
      );
  }
}

async function avisosDeMvp(roundId: number) {
  return db
    .select()
    .from(notifications)
    .where(and(eq(notifications.type, "mvp_do_fut"), eq(notifications.dedupeKey, `mvp:rodada:${roundId}`)));
}

describe("getCandidatosMvp", () => {
  it("lista os dois lados com conta ativa, sem o votante e sem quem não tem conta", async () => {
    const fut = await criarFut();
    const timeA = await criarTrioComConta();
    const timeB = await criarTrioComConta();
    const semConta = await criarJogador();
    await criarJogo(fut, timeA.jogadores, [...timeB.jogadores, semConta]);

    const candidatos = await getCandidatosMvp(fut.id, timeA.jogadores[0].id);
    const ids = candidatos.map((c) => c.playerId).sort((a, b) => a - b);
    const esperados = [...timeA.jogadores.slice(1), ...timeB.jogadores]
      .map((j) => j.id)
      .sort((a, b) => a - b);
    expect(ids).toEqual(esperados);
  });
});

describe("enviarAvaliacoes com o voto de MVP", () => {
  it("sem o voto é erro e nada persiste — o tudo-ou-nada inclui o MVP", async () => {
    const { fut, timeA, rodadaId } = await montarFutCompleto();

    await logarComo(timeA.contas[0]);
    const companheiros = await getCompanheiros(fut.id, timeA.jogadores[0].id);
    const resultado = await enviarAvaliacoes(rodadaId, {}, formulario(companheiros, 8));
    expect(resultado.error).toBe("Falta escolher quem foi o melhor em campo.");

    const notas = await db
      .select()
      .from(ratings)
      .where(eq(ratings.raterPlayerId, timeA.jogadores[0].id));
    expect(notas).toHaveLength(0);
    expect(await votoGravado(rodadaId, timeA.jogadores[0])).toBeNull();
  });

  it("voto em quem não jogou este fut é recusado", async () => {
    const { fut, timeA, rodadaId } = await montarFutCompleto();
    const deOutroFut = await criarJogadorComConta();

    await logarComo(timeA.contas[0]);
    const companheiros = await getCompanheiros(fut.id, timeA.jogadores[0].id);
    const resultado = await enviarAvaliacoes(
      rodadaId,
      {},
      formulario(companheiros, 8, deOutroFut.jogador.id),
    );
    expect(resultado.error).toBe("Esse jogador não jogou este fut.");
    expect(await votoGravado(rodadaId, timeA.jogadores[0])).toBeNull();
  });

  it("votar em si mesmo é recusado — o próprio nunca é candidato", async () => {
    const { fut, timeA, rodadaId } = await montarFutCompleto();

    await logarComo(timeA.contas[0]);
    const companheiros = await getCompanheiros(fut.id, timeA.jogadores[0].id);
    const resultado = await enviarAvaliacoes(
      rodadaId,
      {},
      formulario(companheiros, 8, timeA.jogadores[0].id),
    );
    expect(resultado.error).toBe("Esse jogador não jogou este fut.");
  });

  it("vale votar em quem jogou do OUTRO lado, e o reenvio troca o voto", async () => {
    const { fut, timeA, timeB, rodadaId } = await montarFutCompleto();

    await logarComo(timeA.contas[0]);
    const companheiros = await getCompanheiros(fut.id, timeA.jogadores[0].id);

    const primeiro = await esperaRedirect(
      enviarAvaliacoes(rodadaId, {}, formulario(companheiros, 8, timeB.jogadores[0].id)),
    );
    expect(primeiro).toBe(`/fut/${fut.id}`);
    expect(await votoGravado(rodadaId, timeA.jogadores[0])).toBe(timeB.jogadores[0].id);

    // Reenviar troca o voto e cai na página do fut de novo — mesma saída do
    // primeiro envio, de propósito.
    const segundo = await esperaRedirect(
      enviarAvaliacoes(rodadaId, {}, formulario(companheiros, 8, timeB.jogadores[1].id)),
    );
    expect(segundo).toBe(`/fut/${fut.id}`);
    expect(await votoGravado(rodadaId, timeA.jogadores[0])).toBe(timeB.jogadores[1].id);
  });
});

describe("apuração no fechamento", () => {
  it("o mais votado é notificado quando o último avaliador fecha a rodada", async () => {
    const { fut, timeA, timeB, rodadaId } = await montarFutCompleto();
    const eleito = timeB.jogadores[0];

    const todos = [
      ...timeA.jogadores.map((j, i) => ({ jogador: j, conta: timeA.contas[i] })),
      ...timeB.jogadores.map((j, i) => ({ jogador: j, conta: timeB.contas[i] })),
    ];
    for (const { jogador, conta } of todos) {
      await logarComo(conta);
      const companheiros = await getCompanheiros(fut.id, jogador.id);
      // O eleito não vota em si: vota no primeiro do outro lado.
      const voto = jogador.id === eleito.id ? timeA.jogadores[0].id : eleito.id;
      expect(
        await esperaRedirect(enviarAvaliacoes(rodadaId, {}, formulario(companheiros, 8, voto))),
      ).toBe(`/fut/${fut.id}`);
    }

    const avisos = await avisosDeMvp(rodadaId);
    expect(avisos).toHaveLength(1);
    expect(avisos[0].playerId).toBe(eleito.id);
    expect(avisos[0].href).toBe(`/fut/${fut.id}`);

    expect(await getMvpDoFut(fut.id)).toEqual([
      { playerId: eleito.id, name: eleito.name, nickname: eleito.nickname },
    ]);
  });

  it("fechar por prazo apura com os votos que tem, e o empate cai na média de estrelas", async () => {
    const { timeA, timeB, rodadaId } = await montarFutCompleto();
    const [a1] = timeA.jogadores;
    const [b1] = timeB.jogadores;

    // Duas a duas: empate de votos entre a1 e b1. As médias desempatam — o
    // lado A se avaliou com 10, o lado B com 2.
    await avaliarTrio(rodadaId, timeA.jogadores, 10);
    await avaliarTrio(rodadaId, timeB.jogadores, 2);
    await votar(rodadaId, [
      [timeB.jogadores[0], a1],
      [timeB.jogadores[1], a1],
      [timeA.jogadores[0], b1],
      [timeA.jogadores[1], b1],
    ]);

    expect(await db.transaction((tx) => fecharRodada(tx, rodadaId, "prazo"))).toBe(true);

    const avisos = await avisosDeMvp(rodadaId);
    expect(avisos).toHaveLength(1);
    expect(avisos[0].playerId).toBe(a1.id);
  });

  it("rodada fechada sem nenhum voto não tem MVP nem aviso", async () => {
    const { fut, rodadaId } = await montarFutCompleto();

    await db.transaction((tx) => fecharRodada(tx, rodadaId, "prazo"));

    expect(await avisosDeMvp(rodadaId)).toHaveLength(0);
    expect(await getMvpDoFut(fut.id)).toEqual([]);
  });

  it("um voto só fica abaixo do piso — publicar seria expor o voto do único eleitor", async () => {
    const { fut, timeA, timeB, rodadaId } = await montarFutCompleto();

    await votar(rodadaId, [[timeA.jogadores[0], timeB.jogadores[0]]]);
    await db.transaction((tx) => fecharRodada(tx, rodadaId, "prazo"));

    expect(await avisosDeMvp(rodadaId)).toHaveLength(0);
    expect(await getMvpDoFut(fut.id)).toEqual([]);
  });

  it("conta desativada entre o voto e a apuração não vence", async () => {
    const { fut, timeA, timeB, rodadaId } = await montarFutCompleto();
    const desativado = timeB.jogadores[0];

    // Dois votos, acima do piso: o que zera o MVP aqui é o filtro de conta
    // ativa na apuração, não o piso.
    await votar(rodadaId, [
      [timeA.jogadores[0], desativado],
      [timeA.jogadores[1], desativado],
    ]);
    await db
      .update(users)
      .set({ active: false })
      .where(eq(users.playerId, desativado.id));

    await db.transaction((tx) => fecharRodada(tx, rodadaId, "prazo"));

    expect(await avisosDeMvp(rodadaId)).toHaveLength(0);
    expect(await getMvpDoFut(fut.id)).toEqual([]);
  });
});

describe("getMvpRanking", () => {
  it("conta títulos só do grupo, com filtro de ano, ignorando fut avulso e voto ausente", async () => {
    const [grupo] = await db.insert(groups).values({ name: "Grupo do MVP" }).returning();
    const timeA = await criarTrioComConta();
    const timeB = await criarTrioComConta();
    const [a1] = timeA.jogadores;
    const [b1] = timeB.jogadores;

    // Ranking só conta fut encerrado (escopo) com rodada apurada.
    const montarFutApurado = async (
      extra: Parameters<typeof criarFut>[0],
      votos: Array<[Player, Player]>,
    ) => {
      const fut = await criarFut({ status: "finished", ...extra });
      await criarJogo(fut, timeA.jogadores, timeB.jogadores);
      const rodadaId = (await abrirRodada(db, fut.id))!.roundId;
      await votar(rodadaId, votos);
      await db.transaction((tx) => fecharRodada(tx, rodadaId, "prazo"));
    };

    // a1 vence em 2025 e em 2026 no grupo; b1 só vence no fut avulso. Os
    // eleitores que não votaram (voto NULL) ficam de fora da conta sozinhos.
    // Sempre dois votos por rodada: o piso (MIN_VOTOS_PARA_MVP) não pode ser
    // o que filtra nada neste cenário.
    await montarFutApurado({ groupId: grupo.id, date: "2025-07-01" }, [
      [b1, a1],
      [timeB.jogadores[1], a1],
    ]);
    await montarFutApurado({ groupId: grupo.id, date: "2026-08-05" }, [
      [b1, a1],
      [timeB.jogadores[1], a1],
    ]);
    await montarFutApurado({ date: "2026-08-06" }, [
      [a1, b1],
      [timeA.jogadores[1], b1],
    ]);

    const geral = await getMvpRanking({ groupId: grupo.id });
    expect(geral).toEqual([
      { playerId: a1.id, name: a1.name, nickname: a1.nickname, titulos: 2 },
    ]);

    const de2026 = await getMvpRanking({ groupId: grupo.id, year: 2026 });
    expect(de2026).toEqual([
      { playerId: a1.id, name: a1.name, nickname: a1.nickname, titulos: 1 },
    ]);
  });

  it("título dividido conta para os dois, e o ranking ordena por títulos", async () => {
    const [grupo] = await db.insert(groups).values({ name: "Grupo do empate" }).returning();
    const timeA = await criarTrioComConta();
    const timeB = await criarTrioComConta();
    const [a1] = timeA.jogadores;
    const [b1] = timeB.jogadores;

    const fut = await criarFut({ status: "finished", groupId: grupo.id, date: "2026-08-05" });
    await criarJogo(fut, timeA.jogadores, timeB.jogadores);
    const rodadaId = (await abrirRodada(db, fut.id))!.roundId;
    // Um voto para cada, sem nenhuma avaliação: empate até na média (ambas
    // ausentes) — o título é dividido.
    await votar(rodadaId, [
      [timeB.jogadores[0], a1],
      [timeA.jogadores[0], b1],
    ]);
    await db.transaction((tx) => fecharRodada(tx, rodadaId, "prazo"));

    const avisos = await avisosDeMvp(rodadaId);
    expect(avisos.map((a) => a.playerId).sort((x, y) => x - y)).toEqual(
      [a1.id, b1.id].sort((x, y) => x - y),
    );
    expect(avisos[0].body).toContain("dividido");

    // A ordem entre empatados é por nome (gerado); compara como conjunto.
    const ranking = await getMvpRanking({ groupId: grupo.id });
    expect(
      ranking
        .map((r) => ({ playerId: r.playerId, titulos: r.titulos }))
        .sort((x, y) => x.playerId - y.playerId),
    ).toEqual(
      [
        { playerId: a1.id, titulos: 1 },
        { playerId: b1.id, titulos: 1 },
      ].sort((x, y) => x.playerId - y.playerId),
    );
  });
});
