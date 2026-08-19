// A camada de leitura do perfil público. O alvo é a privacidade: quais grupos
// do alvo o visitante pode ver, e o que o `?grupo=` aceita — os números em si
// saem das funções de ./stats, que têm testes próprios.

import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { gamePlayers, games, goals, teams, type Player } from "@/db/schema";
import { confirmarPresenca, criarFut, criarJogadorComConta } from "@/test/fixtures";
import { criarGrupo, entrarNoGrupo } from "@/test/fixtures-grupo";
import { carregarPerfil } from "./dados";

/** Visitante comum: o `Ator` que a página monta a partir da sessão. */
function visitanteComum(playerId: number) {
  return { playerId, isPlatformAdmin: false };
}

/**
 * Um fut encerrado com um jogo, dois lados e os gols de cada um — o mínimo que
 * as quatro consultas de ./stats precisam para devolver número diferente de
 * zero. Placar é `golsPorJogador` somado por lado, para o V/E/D bater com a
 * artilharia em vez de contar história diferente.
 */
async function futEncerrado(
  ladoA: Array<{ jogador: Player; gols?: number }>,
  ladoB: Array<{ jogador: Player; gols?: number }>,
  opcoes: { groupId?: number } = {},
): Promise<void> {
  const fut = await criarFut({ status: "finished", groupId: opcoes.groupId });
  const [timeA] = await db
    .insert(teams)
    .values({ matchDayId: fut.id, name: "Preto", sortOrder: 0 })
    .returning();
  const [timeB] = await db
    .insert(teams)
    .values({ matchDayId: fut.id, name: "Branco", sortOrder: 1 })
    .returning();
  const soma = (lado: typeof ladoA) => lado.reduce((t, p) => t + (p.gols ?? 0), 0);
  const [jogo] = await db
    .insert(games)
    .values({
      matchDayId: fut.id,
      teamAId: timeA.id,
      teamBId: timeB.id,
      scoreA: soma(ladoA),
      scoreB: soma(ladoB),
    })
    .returning();

  for (const [lado, side] of [
    [ladoA, "A"],
    [ladoB, "B"],
  ] as const) {
    for (const { jogador, gols } of lado) {
      await db.insert(gamePlayers).values({ gameId: jogo.id, playerId: jogador.id, side });
      await confirmarPresenca(fut, jogador);
      if (gols) {
        await db.insert(goals).values({ gameId: jogo.id, playerId: jogador.id, quantity: gols });
      }
    }
  }
}

describe("carregarPerfil: quais grupos do alvo aparecem", () => {
  it("grupo público aparece até para quem não participa dele", async () => {
    const alvo = await criarJogadorComConta();
    const deFora = await criarJogadorComConta();
    const publico = await criarGrupo("Pelada Aberta", { visibility: "public" });
    await entrarNoGrupo(publico, alvo.jogador);

    const dados = await carregarPerfil(
      visitanteComum(deFora.jogador.id),
      alvo.jogador.id,
      undefined,
    );

    expect(dados?.gruposVisiveis.map((g) => g.id)).toContain(publico);
  });

  // O ataque: abrir o perfil de alguém e ler dali a lista dos grupos privados
  // dele — a mesma co-participação que o 404 de /grupo/[id] esconde.
  it("grupo privado some para quem está de fora e fica para o co-membro", async () => {
    const alvo = await criarJogadorComConta();
    const deFora = await criarJogadorComConta();
    const coMembro = await criarJogadorComConta();
    const privado = await criarGrupo("Fut dos Amigos");
    await entrarNoGrupo(privado, alvo.jogador);
    await entrarNoGrupo(privado, coMembro.jogador);

    const paraDeFora = await carregarPerfil(
      visitanteComum(deFora.jogador.id),
      alvo.jogador.id,
      undefined,
    );
    expect(paraDeFora?.gruposVisiveis.map((g) => g.id)).not.toContain(privado);

    const paraCoMembro = await carregarPerfil(
      visitanteComum(coMembro.jogador.id),
      alvo.jogador.id,
      undefined,
    );
    expect(paraCoMembro?.gruposVisiveis.map((g) => g.id)).toContain(privado);
  });

  it("admin da plataforma enxerga o grupo privado alheio", async () => {
    const alvo = await criarJogadorComConta();
    const admin = await criarJogadorComConta();
    const privado = await criarGrupo("Fut dos Amigos");
    await entrarNoGrupo(privado, alvo.jogador);

    const dados = await carregarPerfil(
      { playerId: admin.jogador.id, isPlatformAdmin: true },
      alvo.jogador.id,
      undefined,
    );

    expect(dados?.gruposVisiveis.map((g) => g.id)).toContain(privado);
  });

  it("traz o papel do ALVO no grupo, não o do visitante", async () => {
    const alvo = await criarJogadorComConta();
    const visitante = await criarJogadorComConta();
    const grupo = await criarGrupo("Pelada Aberta", { visibility: "public" });
    await entrarNoGrupo(grupo, alvo.jogador, "admin");
    await entrarNoGrupo(grupo, visitante.jogador, "member");

    const dados = await carregarPerfil(
      visitanteComum(visitante.jogador.id),
      alvo.jogador.id,
      undefined,
    );

    expect(dados?.gruposVisiveis.find((g) => g.id === grupo)?.papel).toBe("admin");
  });
});

describe("carregarPerfil: o que o ?grupo= aceita", () => {
  it("grupo de que o visitante também participa liga o escopo e o MVP", async () => {
    const alvo = await criarJogadorComConta();
    const visitante = await criarJogadorComConta();
    const grupo = await criarGrupo("Pelada Aberta", { visibility: "public" });
    await entrarNoGrupo(grupo, alvo.jogador);
    await entrarNoGrupo(grupo, visitante.jogador);

    const dados = await carregarPerfil(
      visitanteComum(visitante.jogador.id),
      alvo.jogador.id,
      String(grupo),
    );

    expect(dados?.grupoSelecionado?.id).toBe(grupo);
    expect(dados?.numeros.titulosMvp).toBe(0);
  });

  // Ver o grupo e ler o ranking dele são perguntas diferentes: /grupo/[id]
  // abre para qualquer um se o grupo é público, /grupo/[id]/ranking só para
  // membro. Sem esta linha, o `?grupo=` era o ranking daquele grupo servido um
  // jogador por vez, percorrendo a lista de membros que a página pública mostra.
  it("grupo público de que o visitante NÃO participa aparece na lista mas não filtra", async () => {
    const alvo = await criarJogadorComConta();
    const deFora = await criarJogadorComConta();
    const publico = await criarGrupo("Pelada Aberta", { visibility: "public" });
    await entrarNoGrupo(publico, alvo.jogador);

    const dados = await carregarPerfil(
      visitanteComum(deFora.jogador.id),
      alvo.jogador.id,
      String(publico),
    );

    expect(dados?.gruposVisiveis.map((g) => g.id)).toContain(publico);
    expect(dados?.gruposFiltraveis).toEqual([]);
    expect(dados?.grupoSelecionado).toBeNull();
    expect(dados?.numeros.titulosMvp).toBeNull();
  });

  it("admin da plataforma filtra por grupo alheio, como enxerga o resto", async () => {
    const alvo = await criarJogadorComConta();
    const admin = await criarJogadorComConta();
    const privado = await criarGrupo("Fut dos Amigos");
    await entrarNoGrupo(privado, alvo.jogador);

    const dados = await carregarPerfil(
      { playerId: admin.jogador.id, isPlatformAdmin: true },
      alvo.jogador.id,
      String(privado),
    );

    expect(dados?.grupoSelecionado?.id).toBe(privado);
  });

  // Cair calado no geral, e não em 404: a página é legítima, só não pode
  // confirmar que aquele grupo existe nem que o alvo participa dele.
  it("grupo privado alheio cai no escopo geral, sem erro", async () => {
    const alvo = await criarJogadorComConta();
    const deFora = await criarJogadorComConta();
    const privado = await criarGrupo("Fut dos Amigos");
    await entrarNoGrupo(privado, alvo.jogador);

    const dados = await carregarPerfil(
      visitanteComum(deFora.jogador.id),
      alvo.jogador.id,
      String(privado),
    );

    expect(dados?.grupoSelecionado).toBeNull();
    expect(dados?.numeros.titulosMvp).toBeNull();
  });

  it("grupo de que o alvo não participa cai no escopo geral", async () => {
    const alvo = await criarJogadorComConta();
    const visitante = await criarJogadorComConta();
    const soDoVisitante = await criarGrupo("Outro Fut", { visibility: "public" });
    await entrarNoGrupo(soDoVisitante, visitante.jogador);

    const dados = await carregarPerfil(
      visitanteComum(visitante.jogador.id),
      alvo.jogador.id,
      String(soDoVisitante),
    );

    expect(dados?.grupoSelecionado).toBeNull();
  });

  it("valor que não é número cai no escopo geral", async () => {
    const alvo = await criarJogadorComConta();
    const visitante = await criarJogadorComConta();

    const dados = await carregarPerfil(
      visitanteComum(visitante.jogador.id),
      alvo.jogador.id,
      "'; drop table players; --",
    );

    expect(dados?.grupoSelecionado).toBeNull();
  });
});

describe("carregarPerfil: os números", () => {
  it("junta gols, V/E/D, presença e artilharia do fut encerrado", async () => {
    const alvo = await criarJogadorComConta();
    const parceiro = await criarJogadorComConta();
    const rival = await criarJogadorComConta();
    const visitante = await criarJogadorComConta();
    await futEncerrado([{ jogador: alvo.jogador, gols: 2 }, { jogador: parceiro.jogador }], [
      { jogador: rival.jogador, gols: 1 },
    ]);

    const dados = await carregarPerfil(
      visitanteComum(visitante.jogador.id),
      alvo.jogador.id,
      undefined,
    );

    expect(dados?.numeros).toMatchObject({
      gols: 2,
      jogos: 1,
      vitorias: 1,
      empates: 0,
      derrotas: 0,
      aproveitamento: 1,
      presencas: 1,
      totalDays: 1,
      posicaoArtilharia: 1,
    });
  });

  // O caso que o `posicoes()` existe para atender: com `índice + 1`, o segundo
  // dos dois empatados viria 2º aqui e 1º na aba de artilharia, dois cliques
  // adiante — a mesma incoerência que src/lib/posicao.ts documenta.
  it("empate na artilharia divide a posição, como na aba de artilharia", async () => {
    const alvo = await criarJogadorComConta();
    const rival = await criarJogadorComConta();
    const visitante = await criarJogadorComConta();
    await futEncerrado(
      [{ jogador: alvo.jogador, gols: 2 }],
      [{ jogador: rival.jogador, gols: 2 }],
    );

    const paraCada = async (playerId: number) =>
      (await carregarPerfil(visitanteComum(visitante.jogador.id), playerId, undefined))?.numeros;

    expect(await paraCada(alvo.jogador.id)).toMatchObject({
      posicaoArtilharia: 1,
      empates: 1,
      aproveitamento: 0.5,
    });
    expect((await paraCada(rival.jogador.id))?.posicaoArtilharia).toBe(1);
  });

  it("o filtro de grupo recorta os números, e o geral soma os dois futs", async () => {
    const alvo = await criarJogadorComConta();
    const rival = await criarJogadorComConta();
    const grupo = await criarGrupo("Pelada Aberta", { visibility: "public" });
    await entrarNoGrupo(grupo, alvo.jogador);
    await entrarNoGrupo(grupo, rival.jogador);
    await futEncerrado([{ jogador: alvo.jogador, gols: 3 }], [{ jogador: rival.jogador }], {
      groupId: grupo,
    });
    await futEncerrado([{ jogador: alvo.jogador, gols: 1 }], [{ jogador: rival.jogador }]);

    const visitante = visitanteComum(rival.jogador.id);
    const geral = await carregarPerfil(visitante, alvo.jogador.id, undefined);
    const doGrupo = await carregarPerfil(visitante, alvo.jogador.id, String(grupo));

    expect(geral?.numeros).toMatchObject({ gols: 4, jogos: 2, presencas: 2, totalDays: 2 });
    expect(doGrupo?.numeros).toMatchObject({ gols: 3, jogos: 1, presencas: 1, totalDays: 1 });
  });
});

describe("carregarPerfil: alvos fora do comum", () => {
  it("jogador inexistente devolve undefined", async () => {
    const visitante = await criarJogadorComConta();

    expect(
      await carregarPerfil(visitanteComum(visitante.jogador.id), 999_999, undefined),
    ).toBeUndefined();
  });

  it("o próprio perfil carrega igual", async () => {
    const eu = await criarJogadorComConta();

    const dados = await carregarPerfil(visitanteComum(eu.jogador.id), eu.jogador.id, undefined);

    expect(dados?.jogador.id).toBe(eu.jogador.id);
    expect(dados?.numeros.jogos).toBe(0);
    expect(dados?.numeros.aproveitamento).toBeNull();
    expect(dados?.numeros.posicaoArtilharia).toBe(0);
  });
});
