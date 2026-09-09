// As escritas da súmula pelo relógio contra o banco de verdade. O corpo de
// cada operação é o mesmo do painel (servico.ts), já provado em
// sumula/actions.integration.test.ts — o alvo aqui é o que a API acrescenta:
// o jogo aberto resolvido sem id, o autor ditado, o "desfazer pelo lado", o
// default de times do "Novo jogo", os 400 de corpo ruim e o `fut` forçado.

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { gamePlayers, games, players, teamPlayers, teams, trocasDeLado } from "@/db/schema";
import { requireOperadorSumula } from "@/lib/require-operador-sumula";
import { desfazerLancamento } from "@/lib/sumula-servico";
import { criarFut, criarJogador, criarTokenDeApi } from "@/test/fixtures";
import {
  criarDelegado,
  golsDoJogo,
  jogoDoBanco,
  montarSumula,
  type Sumula,
} from "@/test/fixtures-sumula";
import { POST as desfazer } from "./desfazer/route";
import { POST as gol } from "./gol/route";
import { POST as fim } from "./jogo/fim/route";
import { POST as jogo } from "./jogo/route";
import { POST as troca } from "./trocar-de-lado/route";

type Rota = (request: Request) => Promise<Response>;

async function chamar(rota: Rota, token: string | null, corpo: unknown, query = "") {
  const resposta = await rota(
    new Request(`http://localhost/api/sumula/x${query}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token === null ? {} : { authorization: `Bearer ${token}` }),
      },
      body: typeof corpo === "string" ? corpo : JSON.stringify(corpo),
    }),
  );
  return { status: resposta.status, corpo: await resposta.json() };
}

async function montar() {
  const s = await montarSumula();
  const token = await criarTokenDeApi(s.adminConta);
  return { s, token };
}

async function abrir(s: Sumula, token: string) {
  const resposta = await chamar(jogo, token, {});
  expect(resposta.status).toBe(200);
  const [aberto] = await db.select().from(games).where(eq(games.matchDayId, s.fut.id));
  return aberto;
}

async function apelidar(playerIds: number[], nickname: string) {
  await db.update(players).set({ nickname }).where(inArray(players.id, playerIds));
}

describe("POST /api/sumula/jogo", () => {
  it("corpo `{}` abre com os dois primeiros times do sorteio", async () => {
    const { s, token } = await montar();

    const { status, corpo } = await chamar(jogo, token, {});

    expect(status).toBe(200);
    expect(corpo).toMatchObject({
      ok: true,
      jogo: { times: { A: "Preto", B: "Branco" } },
      placar: { A: 0, B: 0 },
      mensagem: "Jogo aberto: Preto 0 × 0 Branco",
    });
    const [aberto] = await db.select().from(games).where(eq(games.matchDayId, s.fut.id));
    expect(aberto).toMatchObject({ id: corpo.jogo.id, scoreA: 0, scoreB: 0, finishedAt: null });
    expect(aberto.startedAt).not.toBeNull();
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith(`/fut/${s.fut.id}/sumula`);
  });

  // O atalho "Novo jogo" não manda corpo NENHUM — nem `{}`, nem content-type.
  // É o byte zero que `lerCorpo` tem que aceitar, e `{}` não o prova.
  it("sem corpo nenhum também abre", async () => {
    const { s, token } = await montar();

    const resposta = await jogo(
      new Request("http://localhost/api/sumula/jogo", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      }),
    );

    expect(resposta.status).toBe(200);
    expect(await db.select().from(games).where(eq(games.matchDayId, s.fut.id))).toHaveLength(1);
  });

  it("times explícitos valem na ordem pedida", async () => {
    const { s, token } = await montar();

    const { corpo } = await chamar(jogo, token, { teamAId: s.timeBId, teamBId: String(s.timeAId) });

    expect(corpo.jogo.times).toEqual({ A: "Branco", B: "Preto" });
  });

  it("só um dos dois, ou os dois iguais, é 400", async () => {
    const { s, token } = await montar();

    expect((await chamar(jogo, token, { teamAId: s.timeAId })).status).toBe(400);
    expect((await chamar(jogo, token, { teamAId: s.timeAId, teamBId: s.timeAId })).status).toBe(400);
    expect(await db.select().from(games).where(eq(games.matchDayId, s.fut.id))).toHaveLength(0);
  });

  it("o segundo jogo é 409 e não grava", async () => {
    const { s, token } = await montar();
    await abrir(s, token);

    const { status, corpo } = await chamar(jogo, token, {});

    expect(status).toBe(409);
    expect(corpo.erro).toBe("ja-tem-jogo-aberto");
    expect(await db.select().from(games).where(eq(games.matchDayId, s.fut.id))).toHaveLength(1);
  });
});

describe("POST /api/sumula/gol", () => {
  it("sem autor soma no placar sem creditar ninguém", async () => {
    const { s, token } = await montar();
    const aberto = await abrir(s, token);

    const { status, corpo } = await chamar(gol, token, { side: "A" });

    expect(status).toBe(200);
    expect(corpo).toMatchObject({
      placar: { A: 1, B: 0 },
      autor: null,
      mensagem: "Gol do Preto — Preto 1 × 0 Branco",
    });
    expect(await jogoDoBanco(aberto.id)).toMatchObject({ scoreA: 1, scoreB: 0 });
    const [lancado] = await golsDoJogo(aberto.id);
    expect(lancado).toMatchObject({
      id: corpo.goalId,
      playerId: null,
      side: "A",
      somadoNoPlacar: true,
      createdByPlayerId: s.admin.id,
    });
  });

  it("com playerId da lista credita o autor", async () => {
    const { s, token } = await montar();
    await apelidar([s.ladoB[0].id], "Igor");
    const aberto = await abrir(s, token);

    const { corpo } = await chamar(gol, token, { side: "b", playerId: String(s.ladoB[0].id) });

    expect(corpo).toMatchObject({
      placar: { A: 0, B: 1 },
      autor: "Igor",
      mensagem: "Gol do Branco (Igor) — Preto 0 × 1 Branco",
    });
    const [lancado] = await golsDoJogo(aberto.id);
    expect(lancado.playerId).toBe(s.ladoB[0].id);
  });

  it("autor ditado acha pelo apelido, sem acento nem maiúscula", async () => {
    const { s, token } = await montar();
    await apelidar([s.ladoA[0].id], "Zé");
    const aberto = await abrir(s, token);

    const { status, corpo } = await chamar(gol, token, { side: "A", autor: "ZE" });

    expect(status).toBe(200);
    expect(corpo.autor).toBe("Zé");
    const [lancado] = await golsDoJogo(aberto.id);
    expect(lancado.playerId).toBe(s.ladoA[0].id);
  });

  // Dois "Zé" do lado A: ninguém leva o gol, e o placar não sobe.
  it("autor ditado ambíguo recusa sem lançar", async () => {
    const { s, token } = await montar();
    await apelidar(
      s.ladoA.map((p) => p.id),
      "Zé",
    );
    const aberto = await abrir(s, token);

    const { status, corpo } = await chamar(gol, token, { side: "A", autor: "Zé" });

    expect(status).toBe(409);
    expect(corpo.erro).toBe("autor-nao-encontrado");
    expect(await jogoDoBanco(aberto.id)).toMatchObject({ scoreA: 0, scoreB: 0 });
    expect(await golsDoJogo(aberto.id)).toHaveLength(0);
  });

  it("autor ditado só procura no lado do gol", async () => {
    const { s, token } = await montar();
    await apelidar([s.ladoB[0].id], "Igor");
    await abrir(s, token);

    const { status, corpo } = await chamar(gol, token, { side: "A", autor: "Igor" });

    expect(status).toBe(409);
    expect(corpo.erro).toBe("autor-nao-encontrado");
  });

  it("playerId do outro lado é recusado e o placar não sobe", async () => {
    const { s, token } = await montar();
    const aberto = await abrir(s, token);

    const { status, corpo } = await chamar(gol, token, { side: "A", playerId: s.ladoB[0].id });

    expect(status).toBe(409);
    expect(corpo.erro).toBe("artilheiro-fora-do-jogo");
    expect(await jogoDoBanco(aberto.id)).toMatchObject({ scoreA: 0, scoreB: 0 });
    expect(await golsDoJogo(aberto.id)).toHaveLength(0);
  });

  it("corpo ruim é 400: JSON quebrado ou que não é objeto, lado inválido, playerId e autor juntos", async () => {
    const { s, token } = await montar();
    const aberto = await abrir(s, token);

    expect((await chamar(gol, token, "{oops")).corpo.erro).toBe("dados-invalidos");
    expect((await chamar(gol, token, "[]")).status).toBe(400);
    expect((await chamar(gol, token, "1")).status).toBe(400);
    expect((await chamar(gol, token, { side: "C" })).status).toBe(400);
    expect((await chamar(gol, token, { side: "A", playerId: 1.5 })).status).toBe(400);
    expect(
      (await chamar(gol, token, { side: "A", playerId: s.ladoA[0].id, autor: "Zé" })).status,
    ).toBe(400);
    expect(await golsDoJogo(aberto.id)).toHaveLength(0);
    expect(await jogoDoBanco(aberto.id)).toMatchObject({ scoreA: 0, scoreB: 0 });
  });

  it("sem jogo aberto é 409", async () => {
    const { token } = await montar();

    const { status, corpo } = await chamar(gol, token, { side: "A" });

    expect(status).toBe(409);
    expect(corpo.erro).toBe("jogo-nao-esta-aberto");
  });
});

describe("POST /api/sumula/desfazer", () => {
  it("pelo lado: desfaz o último ativo daquele lado", async () => {
    const { s, token } = await montar();
    const aberto = await abrir(s, token);
    await chamar(gol, token, { side: "A", playerId: s.ladoA[0].id });
    await chamar(gol, token, { side: "A", playerId: s.ladoA[1].id });
    await chamar(gol, token, { side: "B" });
    const [, segundoDoA] = await golsDoJogo(aberto.id);

    const { status, corpo } = await chamar(desfazer, token, { side: "A" });

    expect(status).toBe(200);
    expect(corpo).toMatchObject({
      goalId: segundoDoA.id,
      placar: { A: 1, B: 1 },
      mensagem: "Desfeito o gol do Preto — Preto 1 × 1 Branco",
    });
    const gols = await golsDoJogo(aberto.id);
    expect(gols[1].desfeitoEm).not.toBeNull();
    expect(gols[1].desfeitoPorPlayerId).toBe(s.admin.id);
    expect(gols[0].desfeitoEm).toBeNull();
  });

  it("sem gol do lado é 409 sem-gol-para-desfazer", async () => {
    const { s, token } = await montar();
    await abrir(s, token);
    await chamar(gol, token, { side: "B" });

    const { status, corpo } = await chamar(desfazer, token, { side: "A" });

    expect(status).toBe(409);
    expect(corpo.erro).toBe("sem-gol-para-desfazer");
  });

  it("goalId explícito: delegado só o último do lado, admin qualquer um", async () => {
    const { s, token } = await montar();
    const delegado = await criarDelegado(s.fut);
    const tokenDoDelegado = await criarTokenDeApi(delegado.conta);
    const aberto = await abrir(s, token);
    await chamar(gol, token, { side: "A", playerId: s.ladoA[0].id });
    await chamar(gol, token, { side: "A", playerId: s.ladoA[1].id });
    const [primeiro] = await golsDoJogo(aberto.id);

    const doDelegado = await chamar(desfazer, tokenDoDelegado, { goalId: primeiro.id });
    expect(doDelegado.status).toBe(409);
    expect(doDelegado.corpo.erro).toBe("desfazer-indisponivel");
    expect(await jogoDoBanco(aberto.id)).toMatchObject({ scoreA: 2 });

    const doAdmin = await chamar(desfazer, token, { goalId: primeiro.id });
    expect(doAdmin.status).toBe(200);
    expect(await jogoDoBanco(aberto.id)).toMatchObject({ scoreA: 1 });
  });

  // A corrida que a rota não consegue encenar: o gol lido como "último do
  // lado" deixa de ser entre a leitura e o UPDATE. `exigirUltimoDoLado` é o
  // que faz o serviço recusar — para o admin também, que sem ele desfaz
  // qualquer um. O operador é o mesmo da rota (o admin de montarSumula, por
  // cookie), só que chamando o serviço direto com um id que já não é o último.
  it("pelo lado, o admin também só desfaz o que ainda é o último — a trava vale no UPDATE", async () => {
    const { s, token } = await montar();
    const aberto = await abrir(s, token);
    await chamar(gol, token, { side: "A" });
    await chamar(gol, token, { side: "A" });
    const [primeiro] = await golsDoJogo(aberto.id);
    const operador = await requireOperadorSumula(s.fut.id);

    await expect(
      desfazerLancamento(operador, { goalId: primeiro.id, exigirUltimoDoLado: true }),
    ).rejects.toMatchObject({ slug: "desfazer-indisponivel" });
    expect(await jogoDoBanco(aberto.id)).toMatchObject({ scoreA: 2 });
    expect((await golsDoJogo(aberto.id))[0].desfeitoEm).toBeNull();

    // Sem a exigência é o caminho do goalId explícito: o admin desfaz qualquer um.
    await desfazerLancamento(operador, { goalId: primeiro.id });
    expect(await jogoDoBanco(aberto.id)).toMatchObject({ scoreA: 1 });
  });

  it("sem lado nem goalId, ou com os dois, é 400; sem jogo aberto é 409", async () => {
    const { s, token } = await montar();
    expect((await chamar(desfazer, token, { side: "A" })).corpo.erro).toBe("jogo-nao-esta-aberto");

    const aberto = await abrir(s, token);
    await chamar(gol, token, { side: "B" });
    const [doB] = await golsDoJogo(aberto.id);
    expect((await chamar(desfazer, token, {})).status).toBe(400);
    // O id é do B e o lado diz A: contraditório, e nada é desfeito.
    expect((await chamar(desfazer, token, { goalId: doB.id, side: "A" })).status).toBe(400);
    expect(await jogoDoBanco(aberto.id)).toMatchObject({ scoreA: 0, scoreB: 1 });
  });
});

describe("POST /api/sumula/trocar-de-lado", () => {
  it("move a pessoa nas três escritas e diz para onde", async () => {
    const { s, token } = await montar();
    await apelidar([s.ladoA[0].id], "Zé");
    const aberto = await abrir(s, token);

    const { status, corpo } = await chamar(troca, token, { playerId: s.ladoA[0].id });

    expect(status).toBe(200);
    expect(corpo).toMatchObject({ de: "A", para: "B", mensagem: "Zé foi para o Branco" });
    const [noJogo] = await db
      .select({ side: gamePlayers.side })
      .from(gamePlayers)
      .where(and(eq(gamePlayers.gameId, aberto.id), eq(gamePlayers.playerId, s.ladoA[0].id)));
    expect(noJogo.side).toBe("B");
    const colete = await db
      .select({ teamId: teamPlayers.teamId })
      .from(teamPlayers)
      .innerJoin(teams, eq(teams.id, teamPlayers.teamId))
      .where(and(eq(teams.matchDayId, s.fut.id), eq(teamPlayers.playerId, s.ladoA[0].id)));
    expect(colete).toEqual([{ teamId: s.timeBId }]);
    expect(await db.select().from(trocasDeLado).where(eq(trocasDeLado.gameId, aberto.id))).toHaveLength(
      1,
    );
  });

  it("o último do lado não sai; quem não está no jogo não troca", async () => {
    const { s, token } = await montar();
    await abrir(s, token);
    await chamar(troca, token, { playerId: s.ladoA[0].id });

    const ultimo = await chamar(troca, token, { playerId: s.ladoA[1].id });
    expect(ultimo.status).toBe(409);
    expect(ultimo.corpo.erro).toBe("jogo-sem-time");

    const deFora = await chamar(troca, token, { playerId: (await criarJogador()).id });
    expect(deFora.corpo.erro).toBe("jogador-fora-do-jogo");

    expect((await chamar(troca, token, {})).status).toBe(400);
  });
});

describe("POST /api/sumula/jogo/fim", () => {
  it("encerra com o placar final; depois disso nada mais entra", async () => {
    const { s, token } = await montar();
    const aberto = await abrir(s, token);
    await chamar(gol, token, { side: "A" });

    const { status, corpo } = await chamar(fim, token, {});

    expect(status).toBe(200);
    expect(corpo).toMatchObject({
      placar: { A: 1, B: 0 },
      mensagem: "Fim de jogo: Preto 1 × 0 Branco",
    });
    expect((await jogoDoBanco(aberto.id)).finishedAt).not.toBeNull();
    expect((await chamar(fim, token, {})).corpo.erro).toBe("jogo-nao-esta-aberto");
    expect((await chamar(gol, token, { side: "A" })).corpo.erro).toBe("jogo-nao-esta-aberto");
    expect(await jogoDoBanco(aberto.id)).toMatchObject({ scoreA: 1, scoreB: 0 });
  });
});

describe("o `fut` forçado", () => {
  // A URL do GET, com `?fut=`, é o que a pessoa copia para montar o POST — e
  // um `fut` da query ignorado lançaria no fut da escolha automática.
  it("na query string vale em POST também; divergir do corpo é 400", async () => {
    const { s, token } = await montar();
    const segundo = await criarFut({ createdByPlayerId: s.admin.id, status: "teams_drawn" });
    await db.insert(teams).values([
      { matchDayId: segundo.id, name: "Azul", sortOrder: 0 },
      { matchDayId: segundo.id, name: "Vermelho", sortOrder: 1 },
    ]);

    const divergente = await chamar(jogo, token, { fut: s.fut.id }, `?fut=${segundo.id}`);
    expect(divergente.status).toBe(400);
    expect(
      await db.select().from(games).where(inArray(games.matchDayId, [s.fut.id, segundo.id])),
    ).toHaveLength(0);

    const { status, corpo } = await chamar(jogo, token, {}, `?fut=${segundo.id}`);
    expect(status).toBe(200);
    expect(corpo.jogo.times).toEqual({ A: "Azul", B: "Vermelho" });
    // Os dois iguais não é divergência.
    expect((await chamar(jogo, token, { fut: segundo.id }, `?fut=${segundo.id}`)).corpo.erro).toBe(
      "ja-tem-jogo-aberto",
    );
  });

  it("no corpo, escolhe entre dois empatados; alheio é 404 e nada é gravado", async () => {
    const { s, token } = await montar();
    const segundo = await criarFut({ createdByPlayerId: s.admin.id, status: "teams_drawn" });
    await db.insert(teams).values([
      { matchDayId: segundo.id, name: "Azul", sortOrder: 0 },
      { matchDayId: segundo.id, name: "Vermelho", sortOrder: 1 },
    ]);

    expect((await chamar(jogo, token, {})).corpo.erro).toBe("varios-futs");

    const { status, corpo } = await chamar(jogo, token, { fut: segundo.id });
    expect(status).toBe(200);
    expect(corpo.jogo.times).toEqual({ A: "Azul", B: "Vermelho" });
    expect(await db.select().from(games).where(eq(games.matchDayId, segundo.id))).toHaveLength(1);

    const alheio = await montarSumula();
    const recusa = await chamar(jogo, token, { fut: alheio.fut.id });
    expect(recusa.status).toBe(404);
    expect(recusa.corpo.erro).toBe("sem-fut-para-operar");
    expect(await db.select().from(games).where(eq(games.matchDayId, alheio.fut.id))).toHaveLength(0);
  });
});
