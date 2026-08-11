// As operações da lista (src/lib/presenca.ts) contra o banco de verdade: o
// corte das vagas, a promoção da espera e o lock que serializa tudo. Cada
// chamada entra por db.transaction, como nos call sites das actions.

import { describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { attendances, matchDays, type MatchDay, type Player } from "@/db/schema";
import {
  entrarNaLista,
  preencherVagasAbertas,
  registrarFalta,
  sairDaLista,
  subirDaEspera,
} from "@/lib/presenca";
import { confirmarPresenca, criarJogador, criarFut } from "@/test/fixtures";

const entrar = (fut: MatchDay, jogador: Player) =>
  db.transaction((tx) => entrarNaLista(tx, fut.id, jogador.id));

const sair = (fut: MatchDay, jogador: Player) =>
  db.transaction((tx) => sairDaLista(tx, fut.id, jogador.id));

async function linhaDe(fut: MatchDay, jogador: Player) {
  const [linha] = await db
    .select({ status: attendances.status, confirmedAt: attendances.confirmedAt })
    .from(attendances)
    .where(and(eq(attendances.matchDayId, fut.id), eq(attendances.playerId, jogador.id)));
  return linha ?? null;
}

const mudarLimite = (fut: MatchDay, maxPlayers: number | null) =>
  db.update(matchDays).set({ maxPlayers }).where(eq(matchDays.id, fut.id));

// Vários no MESMO instante (um insert só = um now() só), para exercitar o
// desempate por id — o escalonado da fixture nunca produz empate de verdade.
async function confirmarNoMesmoInstante(
  fut: MatchDay,
  jogadores: Player[],
  opcoes: { status: "in" | "waitlist"; minutosAtras: number },
) {
  const instante = sql`now() - interval '${sql.raw(String(Math.trunc(opcoes.minutosAtras)))} minutes'`;
  await db.insert(attendances).values(
    jogadores.map((j) => ({
      matchDayId: fut.id,
      playerId: j.id,
      status: opcoes.status,
      confirmedAt: instante,
    })),
  );
}

describe("entrarNaLista", () => {
  it("entra como vaga enquanto o limite não foi atingido", async () => {
    const fut = await criarFut({ maxPlayers: 3 });
    const [a, b, novo] = [await criarJogador(), await criarJogador(), await criarJogador()];
    await confirmarPresenca(fut, a, { minutosAtras: 20 });
    await confirmarPresenca(fut, b, { minutosAtras: 10 });

    await entrar(fut, novo);

    expect((await linhaDe(fut, novo))?.status).toBe("in");
  });

  it("entra como espera quando as vagas acabaram", async () => {
    const fut = await criarFut({ maxPlayers: 2 });
    const [a, b, novo] = [await criarJogador(), await criarJogador(), await criarJogador()];
    await confirmarPresenca(fut, a, { minutosAtras: 20 });
    await confirmarPresenca(fut, b, { minutosAtras: 10 });

    await entrar(fut, novo);

    expect((await linhaDe(fut, novo))?.status).toBe("waitlist");
  });

  it("sem limite, entra como vaga sempre", async () => {
    const fut = await criarFut();
    const jogadores = [await criarJogador(), await criarJogador(), await criarJogador()];
    for (const [i, j] of jogadores.entries()) {
      await confirmarPresenca(fut, j, { minutosAtras: 30 - i * 5 });
    }
    const novo = await criarJogador();

    await entrar(fut, novo);

    expect((await linhaDe(fut, novo))?.status).toBe("in");
  });

  it("reconfirmar preserva o confirmedAt e não disputa a própria vaga", async () => {
    const fut = await criarFut({ maxPlayers: 2 });
    const [a, b] = [await criarJogador(), await criarJogador()];
    await confirmarPresenca(fut, a, { minutosAtras: 20 });
    await confirmarPresenca(fut, b, { minutosAtras: 10 });
    const antes = await linhaDe(fut, a);

    // Fut cheio: se `a` contasse na própria contagem, cairia para a espera.
    await entrar(fut, a);

    const depois = await linhaDe(fut, a);
    expect(depois?.status).toBe("in");
    expect(depois?.confirmedAt?.getTime()).toBe(antes?.confirmedAt?.getTime());
  });

  it("com a lista fechada, entra como vaga mesmo lotada", async () => {
    const fut = await criarFut({ maxPlayers: 2, status: "teams_drawn" });
    const [a, b, atrasado] = [await criarJogador(), await criarJogador(), await criarJogador()];
    await confirmarPresenca(fut, a, { minutosAtras: 20 });
    await confirmarPresenca(fut, b, { minutosAtras: 10 });

    await entrar(fut, atrasado);

    expect((await linhaDe(fut, atrasado))?.status).toBe("in");
  });
});

describe("sairDaLista", () => {
  it("promove o primeiro da espera por ordem de chegada, não por id", async () => {
    const fut = await criarFut({ maxPlayers: 2 });
    const desistente = await criarJogador();
    const outroDono = await criarJogador();
    // Criado ANTES (id menor), confirmado DEPOIS: se a promoção fosse por id,
    // ele passaria na frente de quem chegou primeiro.
    const chegouDepois = await criarJogador();
    const chegouAntes = await criarJogador();
    await confirmarPresenca(fut, desistente, { minutosAtras: 40 });
    await confirmarPresenca(fut, outroDono, { minutosAtras: 30 });
    await confirmarPresenca(fut, chegouAntes, { status: "waitlist", minutosAtras: 15 });
    await confirmarPresenca(fut, chegouDepois, { status: "waitlist", minutosAtras: 5 });

    const promovido = await sair(fut, desistente);

    expect(promovido).toBe(chegouAntes.id);
    expect((await linhaDe(fut, chegouAntes))?.status).toBe("in");
    expect((await linhaDe(fut, chegouDepois))?.status).toBe("waitlist");
    const saida = await linhaDe(fut, desistente);
    expect(saida?.status).toBe("out");
    expect(saida?.confirmedAt).toBeNull();
  });

  it("desempata a espera pelo id quando o instante é o mesmo", async () => {
    const fut = await criarFut({ maxPlayers: 1 });
    const desistente = await criarJogador();
    const idMenor = await criarJogador();
    const idMaior = await criarJogador();
    await confirmarPresenca(fut, desistente, { minutosAtras: 30 });
    await confirmarNoMesmoInstante(fut, [idMaior, idMenor], {
      status: "waitlist",
      minutosAtras: 10,
    });

    const promovido = await sair(fut, desistente);

    expect(promovido).toBe(idMenor.id);
    expect((await linhaDe(fut, idMaior))?.status).toBe("waitlist");
  });

  it("sair da espera ou de fora não promove ninguém", async () => {
    const fut = await criarFut({ maxPlayers: 1 });
    const [dono, daEspera, outroDaEspera] = [
      await criarJogador(),
      await criarJogador(),
      await criarJogador(),
    ];
    await confirmarPresenca(fut, dono, { minutosAtras: 30 });
    await confirmarPresenca(fut, daEspera, { status: "waitlist", minutosAtras: 20 });
    await confirmarPresenca(fut, outroDaEspera, { status: "waitlist", minutosAtras: 10 });

    expect(await sair(fut, daEspera)).toBeNull();
    expect((await linhaDe(fut, outroDaEspera))?.status).toBe("waitlist");

    // Sair de novo já estando fora: também não deixa vaga para trás.
    expect(await sair(fut, daEspera)).toBeNull();
    expect((await linhaDe(fut, outroDaEspera))?.status).toBe("waitlist");
  });

  it("com a lista fechada, não promove", async () => {
    const fut = await criarFut({ maxPlayers: 2, status: "teams_drawn" });
    const [a, b, daEspera] = [await criarJogador(), await criarJogador(), await criarJogador()];
    await confirmarPresenca(fut, a, { minutosAtras: 30 });
    await confirmarPresenca(fut, b, { minutosAtras: 20 });
    await confirmarPresenca(fut, daEspera, { status: "waitlist", minutosAtras: 10 });

    expect(await sair(fut, a)).toBeNull();
    expect((await linhaDe(fut, a))?.status).toBe("out");
    expect((await linhaDe(fut, daEspera))?.status).toBe("waitlist");
  });

  it("com o limite reduzido para baixo dos confirmados, a desistência não promove", async () => {
    const fut = await criarFut({ maxPlayers: 3 });
    const [a, b, c, daEspera] = [
      await criarJogador(),
      await criarJogador(),
      await criarJogador(),
      await criarJogador(),
    ];
    await confirmarPresenca(fut, a, { minutosAtras: 40 });
    await confirmarPresenca(fut, b, { minutosAtras: 30 });
    await confirmarPresenca(fut, c, { minutosAtras: 20 });
    await confirmarPresenca(fut, daEspera, { status: "waitlist", minutosAtras: 10 });
    await mudarLimite(fut, 2);

    // Depois da saída ainda há 2 dentro para 2 vagas: não abriu vaga nenhuma.
    expect(await sair(fut, a)).toBeNull();
    expect((await linhaDe(fut, a))?.status).toBe("out");
    expect((await linhaDe(fut, daEspera))?.status).toBe("waitlist");
  });
});

describe("fut encerrado", () => {
  it("toda operação lança e nada é gravado", async () => {
    const fut = await criarFut({ maxPlayers: 2, status: "finished" });
    const [dentro, daEspera, deFora] = [
      await criarJogador(),
      await criarJogador(),
      await criarJogador(),
    ];
    await confirmarPresenca(fut, dentro, { minutosAtras: 20 });
    await confirmarPresenca(fut, daEspera, { status: "waitlist", minutosAtras: 10 });

    await expect(entrar(fut, deFora)).rejects.toThrow(/encerrado/);
    await expect(sair(fut, dentro)).rejects.toThrow(/encerrado/);
    await expect(
      db.transaction((tx) => subirDaEspera(tx, fut.id, daEspera.id)),
    ).rejects.toThrow(/encerrado/);
    await expect(
      db.transaction((tx) => registrarFalta(tx, fut.id, dentro.id, true)),
    ).rejects.toThrow(/encerrado/);

    expect(await linhaDe(fut, dentro)).toMatchObject({ status: "in" });
    expect(await linhaDe(fut, daEspera)).toMatchObject({ status: "waitlist" });
    expect(await linhaDe(fut, deFora)).toBeNull();
  });
});

describe("subirDaEspera", () => {
  it("sobe quem está na espera e ignora quem está fora", async () => {
    const fut = await criarFut({ maxPlayers: 1, status: "teams_drawn" });
    const [daEspera, deFora] = [await criarJogador(), await criarJogador()];
    await confirmarPresenca(fut, daEspera, { status: "waitlist", minutosAtras: 10 });
    await confirmarPresenca(fut, deFora, { status: "out" });

    await db.transaction((tx) => subirDaEspera(tx, fut.id, daEspera.id));
    await db.transaction((tx) => subirDaEspera(tx, fut.id, deFora.id));

    expect((await linhaDe(fut, daEspera))?.status).toBe("in");
    // "Fora" não vira presença por um id repetido do cliente.
    expect((await linhaDe(fut, deFora))?.status).toBe("out");
  });
});

describe("registrarFalta", () => {
  it("troca in por no_show e desfaz de volta", async () => {
    const fut = await criarFut({ status: "teams_drawn" });
    const jogador = await criarJogador();
    await confirmarPresenca(fut, jogador, { minutosAtras: 10 });

    await db.transaction((tx) => registrarFalta(tx, fut.id, jogador.id, true));
    expect((await linhaDe(fut, jogador))?.status).toBe("no_show");

    await db.transaction((tx) => registrarFalta(tx, fut.id, jogador.id, false));
    expect((await linhaDe(fut, jogador))?.status).toBe("in");
  });

  it("não mexe em quem está fora do status de origem", async () => {
    const fut = await criarFut({ status: "teams_drawn" });
    const [daEspera, deFora] = [await criarJogador(), await criarJogador()];
    await confirmarPresenca(fut, daEspera, { status: "waitlist", minutosAtras: 10 });
    await confirmarPresenca(fut, deFora, { status: "out" });

    await db.transaction((tx) => registrarFalta(tx, fut.id, daEspera.id, true));
    await db.transaction((tx) => registrarFalta(tx, fut.id, deFora.id, false));

    expect((await linhaDe(fut, daEspera))?.status).toBe("waitlist");
    expect((await linhaDe(fut, deFora))?.status).toBe("out");
  });
});

describe("preencherVagasAbertas", () => {
  it("subir o limite promove exatamente as vagas novas, em ordem de chegada", async () => {
    const fut = await criarFut({ maxPlayers: 2 });
    const dentro = [await criarJogador(), await criarJogador()];
    const espera = [await criarJogador(), await criarJogador(), await criarJogador()];
    await confirmarPresenca(fut, dentro[0], { minutosAtras: 60 });
    await confirmarPresenca(fut, dentro[1], { minutosAtras: 50 });
    await confirmarPresenca(fut, espera[0], { status: "waitlist", minutosAtras: 30 });
    await confirmarPresenca(fut, espera[1], { status: "waitlist", minutosAtras: 20 });
    await confirmarPresenca(fut, espera[2], { status: "waitlist", minutosAtras: 10 });

    const promovidos = await db.transaction(async (tx) => {
      await tx.update(matchDays).set({ maxPlayers: 4 }).where(eq(matchDays.id, fut.id));
      return preencherVagasAbertas(tx, fut.id);
    });

    expect(promovidos).toEqual([espera[0].id, espera[1].id]);
    expect((await linhaDe(fut, espera[0]))?.status).toBe("in");
    expect((await linhaDe(fut, espera[1]))?.status).toBe("in");
    expect((await linhaDe(fut, espera[2]))?.status).toBe("waitlist");
  });

  it("limite removido promove a espera inteira", async () => {
    const fut = await criarFut({ maxPlayers: 1 });
    const dono = await criarJogador();
    const espera = [await criarJogador(), await criarJogador()];
    await confirmarPresenca(fut, dono, { minutosAtras: 30 });
    await confirmarPresenca(fut, espera[0], { status: "waitlist", minutosAtras: 20 });
    await confirmarPresenca(fut, espera[1], { status: "waitlist", minutosAtras: 10 });

    const promovidos = await db.transaction(async (tx) => {
      await tx.update(matchDays).set({ maxPlayers: null }).where(eq(matchDays.id, fut.id));
      return preencherVagasAbertas(tx, fut.id);
    });

    expect(promovidos).toEqual([espera[0].id, espera[1].id]);
    expect((await linhaDe(fut, espera[0]))?.status).toBe("in");
    expect((await linhaDe(fut, espera[1]))?.status).toBe("in");
  });

  it("com a lista fechada devolve vazio", async () => {
    const fut = await criarFut({ maxPlayers: 5, status: "teams_drawn" });
    const daEspera = await criarJogador();
    await confirmarPresenca(fut, daEspera, { status: "waitlist", minutosAtras: 10 });

    const promovidos = await db.transaction((tx) => preencherVagasAbertas(tx, fut.id));

    expect(promovidos).toEqual([]);
    expect((await linhaDe(fut, daEspera))?.status).toBe("waitlist");
  });

  it("baixar o limite não rebaixa ninguém", async () => {
    const fut = await criarFut({ maxPlayers: 4 });
    const dentro = [await criarJogador(), await criarJogador(), await criarJogador()];
    for (const [i, j] of dentro.entries()) {
      await confirmarPresenca(fut, j, { minutosAtras: 30 - i * 5 });
    }

    const promovidos = await db.transaction(async (tx) => {
      await tx.update(matchDays).set({ maxPlayers: 2 }).where(eq(matchDays.id, fut.id));
      return preencherVagasAbertas(tx, fut.id);
    });

    expect(promovidos).toEqual([]);
    for (const j of dentro) {
      expect((await linhaDe(fut, j))?.status).toBe("in");
    }
  });
});

describe("concorrência", () => {
  it("duas confirmações disputando a última vaga: uma entra, a outra espera", async () => {
    const fut = await criarFut({ maxPlayers: 2 });
    const dono = await criarJogador();
    const [e, f] = [await criarJogador(), await criarJogador()];
    await confirmarPresenca(fut, dono, { minutosAtras: 30 });

    // Transações paralelas em conexões distintas do pool: o FOR UPDATE do
    // travarFut serializa, e a segunda relê a lista já com a primeira dentro.
    await Promise.all([entrar(fut, e), entrar(fut, f)]);

    const statuses = [(await linhaDe(fut, e))?.status, (await linhaDe(fut, f))?.status];
    expect(statuses.filter((s) => s === "in")).toHaveLength(1);
    expect(statuses.filter((s) => s === "waitlist")).toHaveLength(1);
  });
});
