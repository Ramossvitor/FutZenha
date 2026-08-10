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
import { confirmarPresenca, criarJogador, criarPelada } from "@/test/fixtures";

const entrar = (pelada: MatchDay, jogador: Player) =>
  db.transaction((tx) => entrarNaLista(tx, pelada.id, jogador.id));

const sair = (pelada: MatchDay, jogador: Player) =>
  db.transaction((tx) => sairDaLista(tx, pelada.id, jogador.id));

async function linhaDe(pelada: MatchDay, jogador: Player) {
  const [linha] = await db
    .select({ status: attendances.status, confirmedAt: attendances.confirmedAt })
    .from(attendances)
    .where(and(eq(attendances.matchDayId, pelada.id), eq(attendances.playerId, jogador.id)));
  return linha ?? null;
}

const mudarLimite = (pelada: MatchDay, maxPlayers: number | null) =>
  db.update(matchDays).set({ maxPlayers }).where(eq(matchDays.id, pelada.id));

// Vários no MESMO instante (um insert só = um now() só), para exercitar o
// desempate por id — o escalonado da fixture nunca produz empate de verdade.
async function confirmarNoMesmoInstante(
  pelada: MatchDay,
  jogadores: Player[],
  opcoes: { status: "in" | "waitlist"; minutosAtras: number },
) {
  const instante = sql`now() - interval '${sql.raw(String(Math.trunc(opcoes.minutosAtras)))} minutes'`;
  await db.insert(attendances).values(
    jogadores.map((j) => ({
      matchDayId: pelada.id,
      playerId: j.id,
      status: opcoes.status,
      confirmedAt: instante,
    })),
  );
}

describe("entrarNaLista", () => {
  it("entra como vaga enquanto o limite não foi atingido", async () => {
    const pelada = await criarPelada({ maxPlayers: 3 });
    const [a, b, novo] = [await criarJogador(), await criarJogador(), await criarJogador()];
    await confirmarPresenca(pelada, a, { minutosAtras: 20 });
    await confirmarPresenca(pelada, b, { minutosAtras: 10 });

    await entrar(pelada, novo);

    expect((await linhaDe(pelada, novo))?.status).toBe("in");
  });

  it("entra como espera quando as vagas acabaram", async () => {
    const pelada = await criarPelada({ maxPlayers: 2 });
    const [a, b, novo] = [await criarJogador(), await criarJogador(), await criarJogador()];
    await confirmarPresenca(pelada, a, { minutosAtras: 20 });
    await confirmarPresenca(pelada, b, { minutosAtras: 10 });

    await entrar(pelada, novo);

    expect((await linhaDe(pelada, novo))?.status).toBe("waitlist");
  });

  it("sem limite, entra como vaga sempre", async () => {
    const pelada = await criarPelada();
    const jogadores = [await criarJogador(), await criarJogador(), await criarJogador()];
    for (const [i, j] of jogadores.entries()) {
      await confirmarPresenca(pelada, j, { minutosAtras: 30 - i * 5 });
    }
    const novo = await criarJogador();

    await entrar(pelada, novo);

    expect((await linhaDe(pelada, novo))?.status).toBe("in");
  });

  it("reconfirmar preserva o confirmedAt e não disputa a própria vaga", async () => {
    const pelada = await criarPelada({ maxPlayers: 2 });
    const [a, b] = [await criarJogador(), await criarJogador()];
    await confirmarPresenca(pelada, a, { minutosAtras: 20 });
    await confirmarPresenca(pelada, b, { minutosAtras: 10 });
    const antes = await linhaDe(pelada, a);

    // Pelada cheia: se `a` contasse na própria contagem, cairia para a espera.
    await entrar(pelada, a);

    const depois = await linhaDe(pelada, a);
    expect(depois?.status).toBe("in");
    expect(depois?.confirmedAt?.getTime()).toBe(antes?.confirmedAt?.getTime());
  });

  it("com a lista fechada, entra como vaga mesmo lotada", async () => {
    const pelada = await criarPelada({ maxPlayers: 2, status: "teams_drawn" });
    const [a, b, atrasado] = [await criarJogador(), await criarJogador(), await criarJogador()];
    await confirmarPresenca(pelada, a, { minutosAtras: 20 });
    await confirmarPresenca(pelada, b, { minutosAtras: 10 });

    await entrar(pelada, atrasado);

    expect((await linhaDe(pelada, atrasado))?.status).toBe("in");
  });
});

describe("sairDaLista", () => {
  it("promove o primeiro da espera por ordem de chegada, não por id", async () => {
    const pelada = await criarPelada({ maxPlayers: 2 });
    const desistente = await criarJogador();
    const outroDono = await criarJogador();
    // Criado ANTES (id menor), confirmado DEPOIS: se a promoção fosse por id,
    // ele passaria na frente de quem chegou primeiro.
    const chegouDepois = await criarJogador();
    const chegouAntes = await criarJogador();
    await confirmarPresenca(pelada, desistente, { minutosAtras: 40 });
    await confirmarPresenca(pelada, outroDono, { minutosAtras: 30 });
    await confirmarPresenca(pelada, chegouAntes, { status: "waitlist", minutosAtras: 15 });
    await confirmarPresenca(pelada, chegouDepois, { status: "waitlist", minutosAtras: 5 });

    const promovido = await sair(pelada, desistente);

    expect(promovido).toBe(chegouAntes.id);
    expect((await linhaDe(pelada, chegouAntes))?.status).toBe("in");
    expect((await linhaDe(pelada, chegouDepois))?.status).toBe("waitlist");
    const saida = await linhaDe(pelada, desistente);
    expect(saida?.status).toBe("out");
    expect(saida?.confirmedAt).toBeNull();
  });

  it("desempata a espera pelo id quando o instante é o mesmo", async () => {
    const pelada = await criarPelada({ maxPlayers: 1 });
    const desistente = await criarJogador();
    const idMenor = await criarJogador();
    const idMaior = await criarJogador();
    await confirmarPresenca(pelada, desistente, { minutosAtras: 30 });
    await confirmarNoMesmoInstante(pelada, [idMaior, idMenor], {
      status: "waitlist",
      minutosAtras: 10,
    });

    const promovido = await sair(pelada, desistente);

    expect(promovido).toBe(idMenor.id);
    expect((await linhaDe(pelada, idMaior))?.status).toBe("waitlist");
  });

  it("sair da espera ou de fora não promove ninguém", async () => {
    const pelada = await criarPelada({ maxPlayers: 1 });
    const [dono, daEspera, outroDaEspera] = [
      await criarJogador(),
      await criarJogador(),
      await criarJogador(),
    ];
    await confirmarPresenca(pelada, dono, { minutosAtras: 30 });
    await confirmarPresenca(pelada, daEspera, { status: "waitlist", minutosAtras: 20 });
    await confirmarPresenca(pelada, outroDaEspera, { status: "waitlist", minutosAtras: 10 });

    expect(await sair(pelada, daEspera)).toBeNull();
    expect((await linhaDe(pelada, outroDaEspera))?.status).toBe("waitlist");

    // Sair de novo já estando fora: também não deixa vaga para trás.
    expect(await sair(pelada, daEspera)).toBeNull();
    expect((await linhaDe(pelada, outroDaEspera))?.status).toBe("waitlist");
  });

  it("com a lista fechada, não promove", async () => {
    const pelada = await criarPelada({ maxPlayers: 2, status: "teams_drawn" });
    const [a, b, daEspera] = [await criarJogador(), await criarJogador(), await criarJogador()];
    await confirmarPresenca(pelada, a, { minutosAtras: 30 });
    await confirmarPresenca(pelada, b, { minutosAtras: 20 });
    await confirmarPresenca(pelada, daEspera, { status: "waitlist", minutosAtras: 10 });

    expect(await sair(pelada, a)).toBeNull();
    expect((await linhaDe(pelada, a))?.status).toBe("out");
    expect((await linhaDe(pelada, daEspera))?.status).toBe("waitlist");
  });

  it("com o limite reduzido para baixo dos confirmados, a desistência não promove", async () => {
    const pelada = await criarPelada({ maxPlayers: 3 });
    const [a, b, c, daEspera] = [
      await criarJogador(),
      await criarJogador(),
      await criarJogador(),
      await criarJogador(),
    ];
    await confirmarPresenca(pelada, a, { minutosAtras: 40 });
    await confirmarPresenca(pelada, b, { minutosAtras: 30 });
    await confirmarPresenca(pelada, c, { minutosAtras: 20 });
    await confirmarPresenca(pelada, daEspera, { status: "waitlist", minutosAtras: 10 });
    await mudarLimite(pelada, 2);

    // Depois da saída ainda há 2 dentro para 2 vagas: não abriu vaga nenhuma.
    expect(await sair(pelada, a)).toBeNull();
    expect((await linhaDe(pelada, a))?.status).toBe("out");
    expect((await linhaDe(pelada, daEspera))?.status).toBe("waitlist");
  });
});

describe("pelada encerrada", () => {
  it("toda operação lança e nada é gravado", async () => {
    const pelada = await criarPelada({ maxPlayers: 2, status: "finished" });
    const [dentro, daEspera, deFora] = [
      await criarJogador(),
      await criarJogador(),
      await criarJogador(),
    ];
    await confirmarPresenca(pelada, dentro, { minutosAtras: 20 });
    await confirmarPresenca(pelada, daEspera, { status: "waitlist", minutosAtras: 10 });

    await expect(entrar(pelada, deFora)).rejects.toThrow(/encerrada/);
    await expect(sair(pelada, dentro)).rejects.toThrow(/encerrada/);
    await expect(
      db.transaction((tx) => subirDaEspera(tx, pelada.id, daEspera.id)),
    ).rejects.toThrow(/encerrada/);
    await expect(
      db.transaction((tx) => registrarFalta(tx, pelada.id, dentro.id, true)),
    ).rejects.toThrow(/encerrada/);

    expect(await linhaDe(pelada, dentro)).toMatchObject({ status: "in" });
    expect(await linhaDe(pelada, daEspera)).toMatchObject({ status: "waitlist" });
    expect(await linhaDe(pelada, deFora)).toBeNull();
  });
});

describe("subirDaEspera", () => {
  it("sobe quem está na espera e ignora quem está fora", async () => {
    const pelada = await criarPelada({ maxPlayers: 1, status: "teams_drawn" });
    const [daEspera, deFora] = [await criarJogador(), await criarJogador()];
    await confirmarPresenca(pelada, daEspera, { status: "waitlist", minutosAtras: 10 });
    await confirmarPresenca(pelada, deFora, { status: "out" });

    await db.transaction((tx) => subirDaEspera(tx, pelada.id, daEspera.id));
    await db.transaction((tx) => subirDaEspera(tx, pelada.id, deFora.id));

    expect((await linhaDe(pelada, daEspera))?.status).toBe("in");
    // "Fora" não vira presença por um id repetido do cliente.
    expect((await linhaDe(pelada, deFora))?.status).toBe("out");
  });
});

describe("registrarFalta", () => {
  it("troca in por no_show e desfaz de volta", async () => {
    const pelada = await criarPelada({ status: "teams_drawn" });
    const jogador = await criarJogador();
    await confirmarPresenca(pelada, jogador, { minutosAtras: 10 });

    await db.transaction((tx) => registrarFalta(tx, pelada.id, jogador.id, true));
    expect((await linhaDe(pelada, jogador))?.status).toBe("no_show");

    await db.transaction((tx) => registrarFalta(tx, pelada.id, jogador.id, false));
    expect((await linhaDe(pelada, jogador))?.status).toBe("in");
  });

  it("não mexe em quem está fora do status de origem", async () => {
    const pelada = await criarPelada({ status: "teams_drawn" });
    const [daEspera, deFora] = [await criarJogador(), await criarJogador()];
    await confirmarPresenca(pelada, daEspera, { status: "waitlist", minutosAtras: 10 });
    await confirmarPresenca(pelada, deFora, { status: "out" });

    await db.transaction((tx) => registrarFalta(tx, pelada.id, daEspera.id, true));
    await db.transaction((tx) => registrarFalta(tx, pelada.id, deFora.id, false));

    expect((await linhaDe(pelada, daEspera))?.status).toBe("waitlist");
    expect((await linhaDe(pelada, deFora))?.status).toBe("out");
  });
});

describe("preencherVagasAbertas", () => {
  it("subir o limite promove exatamente as vagas novas, em ordem de chegada", async () => {
    const pelada = await criarPelada({ maxPlayers: 2 });
    const dentro = [await criarJogador(), await criarJogador()];
    const espera = [await criarJogador(), await criarJogador(), await criarJogador()];
    await confirmarPresenca(pelada, dentro[0], { minutosAtras: 60 });
    await confirmarPresenca(pelada, dentro[1], { minutosAtras: 50 });
    await confirmarPresenca(pelada, espera[0], { status: "waitlist", minutosAtras: 30 });
    await confirmarPresenca(pelada, espera[1], { status: "waitlist", minutosAtras: 20 });
    await confirmarPresenca(pelada, espera[2], { status: "waitlist", minutosAtras: 10 });

    const promovidos = await db.transaction(async (tx) => {
      await tx.update(matchDays).set({ maxPlayers: 4 }).where(eq(matchDays.id, pelada.id));
      return preencherVagasAbertas(tx, pelada.id);
    });

    expect(promovidos).toEqual([espera[0].id, espera[1].id]);
    expect((await linhaDe(pelada, espera[0]))?.status).toBe("in");
    expect((await linhaDe(pelada, espera[1]))?.status).toBe("in");
    expect((await linhaDe(pelada, espera[2]))?.status).toBe("waitlist");
  });

  it("limite removido promove a espera inteira", async () => {
    const pelada = await criarPelada({ maxPlayers: 1 });
    const dono = await criarJogador();
    const espera = [await criarJogador(), await criarJogador()];
    await confirmarPresenca(pelada, dono, { minutosAtras: 30 });
    await confirmarPresenca(pelada, espera[0], { status: "waitlist", minutosAtras: 20 });
    await confirmarPresenca(pelada, espera[1], { status: "waitlist", minutosAtras: 10 });

    const promovidos = await db.transaction(async (tx) => {
      await tx.update(matchDays).set({ maxPlayers: null }).where(eq(matchDays.id, pelada.id));
      return preencherVagasAbertas(tx, pelada.id);
    });

    expect(promovidos).toEqual([espera[0].id, espera[1].id]);
    expect((await linhaDe(pelada, espera[0]))?.status).toBe("in");
    expect((await linhaDe(pelada, espera[1]))?.status).toBe("in");
  });

  it("com a lista fechada devolve vazio", async () => {
    const pelada = await criarPelada({ maxPlayers: 5, status: "teams_drawn" });
    const daEspera = await criarJogador();
    await confirmarPresenca(pelada, daEspera, { status: "waitlist", minutosAtras: 10 });

    const promovidos = await db.transaction((tx) => preencherVagasAbertas(tx, pelada.id));

    expect(promovidos).toEqual([]);
    expect((await linhaDe(pelada, daEspera))?.status).toBe("waitlist");
  });

  it("baixar o limite não rebaixa ninguém", async () => {
    const pelada = await criarPelada({ maxPlayers: 4 });
    const dentro = [await criarJogador(), await criarJogador(), await criarJogador()];
    for (const [i, j] of dentro.entries()) {
      await confirmarPresenca(pelada, j, { minutosAtras: 30 - i * 5 });
    }

    const promovidos = await db.transaction(async (tx) => {
      await tx.update(matchDays).set({ maxPlayers: 2 }).where(eq(matchDays.id, pelada.id));
      return preencherVagasAbertas(tx, pelada.id);
    });

    expect(promovidos).toEqual([]);
    for (const j of dentro) {
      expect((await linhaDe(pelada, j))?.status).toBe("in");
    }
  });
});

describe("concorrência", () => {
  it("duas confirmações disputando a última vaga: uma entra, a outra espera", async () => {
    const pelada = await criarPelada({ maxPlayers: 2 });
    const dono = await criarJogador();
    const [e, f] = [await criarJogador(), await criarJogador()];
    await confirmarPresenca(pelada, dono, { minutosAtras: 30 });

    // Transações paralelas em conexões distintas do pool: o FOR UPDATE do
    // travarPelada serializa, e a segunda relê a lista já com a primeira dentro.
    await Promise.all([entrar(pelada, e), entrar(pelada, f)]);

    const statuses = [(await linhaDe(pelada, e))?.status, (await linhaDe(pelada, f))?.status];
    expect(statuses.filter((s) => s === "in")).toHaveLength(1);
    expect(statuses.filter((s) => s === "waitlist")).toHaveLength(1);
  });
});
