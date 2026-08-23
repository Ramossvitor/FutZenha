// As actions do editor de times: o "montar" (os times vêm prontos do
// organizador e a lista fecha no submit) e o "mover" (um jogador de cada vez,
// depois que a lista fechou). O sorteio tem a própria suíte em
// presenca-actions.integration.test.ts — o caminho de gravação é compartilhado.

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db";
import {
  attendances,
  gamePlayers,
  games,
  matchDays,
  notifications,
  teamPlayers,
  teams,
  type MatchDay,
  type Player,
} from "@/db/schema";
import { esperaRedirect } from "@/test/navigation-fake";
import { montarSumula } from "@/test/fixtures-sumula";
import {
  confirmarPresenca,
  criarFut,
  criarJogador,
  criarJogadorComConta,
  logarComo,
} from "@/test/fixtures";
import { createGame, montarTimesAction, moverJogadorAction } from "./actions";

async function futAbertoComAdmin(): Promise<{ fut: MatchDay; admin: Player }> {
  const { jogador, conta } = await criarJogadorComConta();
  await logarComo(conta);
  const fut = await criarFut({ createdByPlayerId: jogador.id });
  return { fut, admin: jogador };
}

function formDeLados(lados: Record<number, "A" | "B">): FormData {
  const form = new FormData();
  for (const [id, lado] of Object.entries(lados)) form.set(`lado-${id}`, lado);
  return form;
}

/** O colete de cada um, por nome de time — o que o editor mostra. */
async function coletes(matchDayId: number): Promise<Record<number, string>> {
  const rows = await db
    .select({ playerId: teamPlayers.playerId, nome: teams.name })
    .from(teamPlayers)
    .innerJoin(teams, eq(teamPlayers.teamId, teams.id))
    .where(eq(teams.matchDayId, matchDayId));
  return Object.fromEntries(rows.map((r) => [r.playerId, r.nome]));
}

describe("montarTimesAction", () => {
  it("grava Preto e Branco na ordem, fecha a lista e avisa quem tem conta — menos o admin", async () => {
    const { fut, admin } = await futAbertoComAdmin();
    const { jogador: comConta } = await criarJogadorComConta();
    const a = await criarJogador();
    const b = await criarJogador();
    await confirmarPresenca(fut, admin, { minutosAtras: 40 });
    await confirmarPresenca(fut, comConta, { minutosAtras: 30 });
    await confirmarPresenca(fut, a, { minutosAtras: 20 });
    await confirmarPresenca(fut, b, { minutosAtras: 10 });

    const url = await esperaRedirect(
      montarTimesAction(
        fut.id,
        formDeLados({
          [admin.id]: "A",
          [comConta.id]: "A",
          [a.id]: "B",
          [b.id]: "B",
        }),
      ),
    );

    expect(url).toBe(`/fut/${fut.id}/gerenciar`);
    const [depois] = await db
      .select()
      .from(matchDays)
      .where(eq(matchDays.id, fut.id));
    expect(depois.status).toBe("teams_drawn");

    const times = await db
      .select()
      .from(teams)
      .where(eq(teams.matchDayId, fut.id));
    expect(times.map((t) => [t.name, t.sortOrder])).toEqual([
      ["Preto", 0],
      ["Branco", 1],
    ]);
    expect(await coletes(fut.id)).toEqual({
      [admin.id]: "Preto",
      [comConta.id]: "Preto",
      [a.id]: "Branco",
      [b.id]: "Branco",
    });

    const avisos = await db
      .select()
      .from(notifications)
      .where(eq(notifications.playerId, comConta.id));
    expect(avisos).toHaveLength(1);
    expect(avisos[0].type).toBe("pelada_times_sorteados");
    expect(
      await db
        .select()
        .from(notifications)
        .where(eq(notifications.playerId, admin.id)),
    ).toHaveLength(0);
  });

  it("ignora quem não está na lista (saiu, espera, forjado) e só exige lado de quem está", async () => {
    const { fut } = await futAbertoComAdmin();
    const a = await criarJogador();
    const b = await criarJogador();
    const saiu = await criarJogador();
    const daEspera = await criarJogador();
    const estranho = await criarJogador();
    await confirmarPresenca(fut, a, { minutosAtras: 20 });
    await confirmarPresenca(fut, b, { minutosAtras: 10 });
    await confirmarPresenca(fut, saiu, { status: "out" });
    await confirmarPresenca(fut, daEspera, {
      status: "waitlist",
      minutosAtras: 5,
    });

    await esperaRedirect(
      montarTimesAction(
        fut.id,
        formDeLados({
          [a.id]: "A",
          [b.id]: "B",
          [saiu.id]: "A",
          [daEspera.id]: "B",
          [estranho.id]: "A",
        }),
      ),
    );

    expect(
      Object.keys(await coletes(fut.id))
        .map(Number)
        .sort(),
    ).toEqual([a.id, b.id].sort());
  });

  it("recusa confirmado sem lado — quem não joga sai da lista, não fica sem time", async () => {
    const { fut } = await futAbertoComAdmin();
    const a = await criarJogador();
    const b = await criarJogador();
    const esquecido = await criarJogador();
    for (const [i, j] of [a, b, esquecido].entries()) {
      await confirmarPresenca(fut, j, { minutosAtras: 30 - i * 10 });
    }

    const url = await esperaRedirect(
      montarTimesAction(fut.id, formDeLados({ [a.id]: "A", [b.id]: "B" })),
    );

    expect(url).toBe(`/fut/${fut.id}/gerenciar?erro=jogador-sem-time`);
    const [depois] = await db
      .select()
      .from(matchDays)
      .where(eq(matchDays.id, fut.id));
    expect(depois.status).toBe("scheduled");
    expect(
      await db.select().from(teams).where(eq(teams.matchDayId, fut.id)),
    ).toHaveLength(0);
  });

  it("ignora jogador desativado que ficou `in` — o editor não o mostra, então não exige lado dele", async () => {
    const { fut } = await futAbertoComAdmin();
    const a = await criarJogador();
    const b = await criarJogador();
    const desativado = await criarJogador({ active: false });
    await confirmarPresenca(fut, a, { minutosAtras: 30 });
    await confirmarPresenca(fut, b, { minutosAtras: 20 });
    await confirmarPresenca(fut, desativado, { minutosAtras: 10 });

    const url = await esperaRedirect(
      montarTimesAction(fut.id, formDeLados({ [a.id]: "A", [b.id]: "B" })),
    );

    expect(url).toBe(`/fut/${fut.id}/gerenciar`);
    expect(await coletes(fut.id)).toEqual({ [a.id]: "Preto", [b.id]: "Branco" });
  });

  it("re-montar substitui os times e não repete o aviso", async () => {
    const { fut, admin } = await futAbertoComAdmin();
    const { jogador: comConta } = await criarJogadorComConta();
    await confirmarPresenca(fut, admin, { minutosAtras: 20 });
    await confirmarPresenca(fut, comConta, { minutosAtras: 10 });

    await esperaRedirect(
      montarTimesAction(fut.id, formDeLados({ [admin.id]: "A", [comConta.id]: "B" })),
    );
    const primeiros = await db.select().from(teams).where(eq(teams.matchDayId, fut.id));
    await esperaRedirect(
      montarTimesAction(fut.id, formDeLados({ [admin.id]: "B", [comConta.id]: "A" })),
    );

    const segundos = await db.select().from(teams).where(eq(teams.matchDayId, fut.id));
    expect(segundos).toHaveLength(2);
    expect(segundos.map((t) => t.id)).not.toEqual(primeiros.map((t) => t.id));
    expect(await coletes(fut.id)).toEqual({
      [admin.id]: "Branco",
      [comConta.id]: "Preto",
    });
    expect(
      await db.select().from(notifications).where(eq(notifications.playerId, comConta.id)),
    ).toHaveLength(1);
  });

  it("recusa fut encerrado", async () => {
    const { fut } = await futAbertoComAdmin();
    const a = await criarJogador();
    const b = await criarJogador();
    await confirmarPresenca(fut, a, { minutosAtras: 20 });
    await confirmarPresenca(fut, b, { minutosAtras: 10 });
    await db.update(matchDays).set({ status: "finished" }).where(eq(matchDays.id, fut.id));

    const url = await esperaRedirect(
      montarTimesAction(fut.id, formDeLados({ [a.id]: "A", [b.id]: "B" })),
    );

    expect(url).toBe(`/fut/${fut.id}/gerenciar?erro=escalacao-travada`);
    expect(await db.select().from(teams).where(eq(teams.matchDayId, fut.id))).toHaveLength(0);
  });

  it("recusa time vazio", async () => {
    const { fut } = await futAbertoComAdmin();
    const a = await criarJogador();
    const b = await criarJogador();
    await confirmarPresenca(fut, a, { minutosAtras: 20 });
    await confirmarPresenca(fut, b, { minutosAtras: 10 });

    const url = await esperaRedirect(
      montarTimesAction(fut.id, formDeLados({ [a.id]: "A", [b.id]: "A" })),
    );

    expect(url).toBe(`/fut/${fut.id}/gerenciar?erro=time-vazio`);
  });

  it("recusa montar por cima de fut com jogo lançado", async () => {
    const s = await montarSumula();
    for (const [i, p] of [...s.ladoA, ...s.ladoB].entries()) {
      await confirmarPresenca(s.fut, p, { minutosAtras: 40 - i * 10 });
    }
    const form = new FormData();
    form.set("teamAId", String(s.timeAId));
    form.set("teamBId", String(s.timeBId));
    form.set("scoreA", "1");
    form.set("scoreB", "0");
    await createGame(s.fut.id, form);

    const url = await esperaRedirect(
      montarTimesAction(
        s.fut.id,
        formDeLados({
          [s.ladoA[0].id]: "A",
          [s.ladoA[1].id]: "A",
          [s.ladoB[0].id]: "B",
          [s.ladoB[1].id]: "B",
        }),
      ),
    );

    expect(url).toBe(`/fut/${s.fut.id}/gerenciar?erro=jogos-lancados`);
  });
});

describe("moverJogadorAction", () => {
  /** Fut sorteado 2×2 com todo mundo na lista — o que o editor exige. */
  async function sorteadoComLista() {
    const s = await montarSumula();
    for (const [i, p] of [...s.ladoA, ...s.ladoB].entries()) {
      await confirmarPresenca(s.fut, p, { minutosAtras: 40 - i * 10 });
    }
    return s;
  }

  it("move para o outro time sem permutar ninguém — os times ficam desiguais", async () => {
    const s = await sorteadoComLista();
    const [movido, fica] = s.ladoA;

    await moverJogadorAction(s.fut.id, movido.id, s.timeBId);

    const depois = await coletes(s.fut.id);
    expect(depois[movido.id]).toBe("Branco");
    expect(depois[fica.id]).toBe("Preto");
    expect(Object.values(depois).filter((n) => n === "Branco")).toHaveLength(3);
  });

  it("tira do time (destino null) e traz de volta", async () => {
    const s = await sorteadoComLista();
    const [p] = s.ladoA;

    await moverJogadorAction(s.fut.id, p.id, null);
    expect((await coletes(s.fut.id))[p.id]).toBeUndefined();

    await moverJogadorAction(s.fut.id, p.id, s.timeAId);
    expect((await coletes(s.fut.id))[p.id]).toBe("Preto");
  });

  it("dá colete a quem entrou depois do sorteio", async () => {
    const s = await sorteadoComLista();
    const tardio = await criarJogador();
    await confirmarPresenca(s.fut, tardio, { minutosAtras: 1 });

    await moverJogadorAction(s.fut.id, tardio.id, s.timeBId);

    expect((await coletes(s.fut.id))[tardio.id]).toBe("Branco");
  });

  it("recusa quem não está na lista, mas deixa tirá-lo do time", async () => {
    const s = await sorteadoComLista();
    const deFora = await criarJogador();
    await confirmarPresenca(s.fut, deFora, {
      status: "waitlist",
      minutosAtras: 1,
    });

    const url = await esperaRedirect(
      moverJogadorAction(s.fut.id, deFora.id, s.timeAId),
    );
    expect(url).toBe(`/fut/${s.fut.id}/gerenciar?erro=jogador-fora-da-lista`);

    // Quem saiu da lista depois do sorteio ainda tem colete — e precisa poder perdê-lo.
    const [saiu] = s.ladoB;
    await db
      .update(attendances)
      .set({ status: "out" })
      .where(eq(attendances.playerId, saiu.id));
    await moverJogadorAction(s.fut.id, saiu.id, null);
    expect((await coletes(s.fut.id))[saiu.id]).toBeUndefined();
  });

  it("recusa time de outro fut", async () => {
    const s = await sorteadoComLista();
    const outro = await criarFut({ status: "teams_drawn" });
    const [timeAlheio] = await db
      .insert(teams)
      .values({ matchDayId: outro.id, name: "Verde", sortOrder: 0 })
      .returning();

    const url = await esperaRedirect(
      moverJogadorAction(s.fut.id, s.ladoA[0].id, timeAlheio.id),
    );

    expect(url).toBe(`/fut/${s.fut.id}/gerenciar?erro=dados-invalidos`);
    expect((await coletes(s.fut.id))[s.ladoA[0].id]).toBe("Preto");
  });

  it("recusa fut encerrado e id que não é inteiro", async () => {
    const s = await sorteadoComLista();
    const [p] = s.ladoA;

    expect(await esperaRedirect(moverJogadorAction(s.fut.id, Number.NaN, s.timeBId))).toBe(
      `/fut/${s.fut.id}/gerenciar?erro=dados-invalidos`,
    );
    expect(await esperaRedirect(moverJogadorAction(s.fut.id, p.id, 1.5))).toBe(
      `/fut/${s.fut.id}/gerenciar?erro=dados-invalidos`,
    );

    await db.update(matchDays).set({ status: "finished" }).where(eq(matchDays.id, s.fut.id));
    expect(await esperaRedirect(moverJogadorAction(s.fut.id, p.id, s.timeBId))).toBe(
      `/fut/${s.fut.id}/gerenciar?erro=escalacao-travada`,
    );
    expect((await coletes(s.fut.id))[p.id]).toBe("Preto");
  });

  it("só vale com a lista fechada", async () => {
    const { fut } = await futAbertoComAdmin();
    const p = await criarJogador();
    await confirmarPresenca(fut, p);

    const url = await esperaRedirect(moverJogadorAction(fut.id, p.id, null));

    expect(url).toBe(`/fut/${fut.id}/gerenciar?erro=lista-aberta`);
  });

  it("não mexe na escalação de jogo já criado — só o próximo nasce com o colete novo", async () => {
    const s = await sorteadoComLista();
    const form = new FormData();
    form.set("teamAId", String(s.timeAId));
    form.set("teamBId", String(s.timeBId));
    form.set("scoreA", "0");
    form.set("scoreB", "0");
    await createGame(s.fut.id, form);
    const [jogo] = await db
      .select()
      .from(games)
      .where(eq(games.matchDayId, s.fut.id));
    const [movido] = s.ladoA;

    await moverJogadorAction(s.fut.id, movido.id, s.timeBId);

    const escalacao = await db
      .select({ playerId: gamePlayers.playerId, side: gamePlayers.side })
      .from(gamePlayers)
      .where(eq(gamePlayers.gameId, jogo.id));
    expect(escalacao).toContainEqual({ playerId: movido.id, side: "A" });
  });
});
