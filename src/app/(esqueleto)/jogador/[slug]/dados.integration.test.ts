// A camada de leitura do perfil público. O alvo é a privacidade: quais grupos
// do alvo o visitante pode ver, e o que o `?grupo=` aceita — os números em si
// saem das funções de ./stats, que têm testes próprios.

import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { gamePlayers, games, goals, lojaItens, teams, zenhaInventario, type Player } from "@/db/schema";
import { creditar } from "@/lib/carteira";
import { comprar, tirarDaVitrine } from "@/lib/loja";
import { getJogadorPorSlug, type PerfilJogador } from "@/lib/jogadores";
import { confirmarPresenca, criarFut, criarJogadorComConta } from "@/test/fixtures";
import { criarGrupo, entrarNoGrupo } from "@/test/fixtures-grupo";
import { criarBadge, criarCorDoNome, criarMoldura, criarTitulo } from "@/test/fixtures-loja";
import { carregarPerfil } from "./dados";

/**
 * O alvo como a página o entrega: resolvido antes de `carregarPerfil`.
 *
 * A página traduz o slug da URL em jogador e só então chama a camada de dados —
 * "não existe" morre lá, no notFound(), e não aqui dentro.
 */
async function perfilDe(jogador: Player): Promise<PerfilJogador> {
  const perfil = await getJogadorPorSlug(jogador.slug);
  if (!perfil) throw new Error(`jogador ${jogador.id} sumiu entre a fixture e a leitura`);
  return perfil;
}

/** Saldo para o alvo poder comprar o que a vitrine vai mostrar. */
async function creditarParaComprar(playerId: number, saldo: number): Promise<void> {
  await creditar(db, [
    {
      playerId,
      motivo: "boas_vindas",
      amount: saldo,
      dedupeKey: "boas-vindas",
      descricao: "Saldo de fixture",
    },
  ]);
}

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
    const publico = (await criarGrupo("Pelada Aberta", { visibility: "public" })).id;
    await entrarNoGrupo(publico, alvo.jogador);

    const dados = await carregarPerfil(
      visitanteComum(deFora.jogador.id),
      await perfilDe(alvo.jogador),
      undefined,
    );

    expect(dados.gruposVisiveis.map((g) => g.id)).toContain(publico);
  });

  // O ataque: abrir o perfil de alguém e ler dali a lista dos grupos privados
  // dele — a mesma co-participação que o 404 de /grupo/[slug] esconde.
  it("grupo privado some para quem está de fora e fica para o co-membro", async () => {
    const alvo = await criarJogadorComConta();
    const deFora = await criarJogadorComConta();
    const coMembro = await criarJogadorComConta();
    const privado = (await criarGrupo("Fut dos Amigos")).id;
    await entrarNoGrupo(privado, alvo.jogador);
    await entrarNoGrupo(privado, coMembro.jogador);

    const paraDeFora = await carregarPerfil(
      visitanteComum(deFora.jogador.id),
      await perfilDe(alvo.jogador),
      undefined,
    );
    expect(paraDeFora.gruposVisiveis.map((g) => g.id)).not.toContain(privado);

    const paraCoMembro = await carregarPerfil(
      visitanteComum(coMembro.jogador.id),
      await perfilDe(alvo.jogador),
      undefined,
    );
    expect(paraCoMembro.gruposVisiveis.map((g) => g.id)).toContain(privado);
  });

  it("admin da plataforma enxerga o grupo privado alheio", async () => {
    const alvo = await criarJogadorComConta();
    const admin = await criarJogadorComConta();
    const privado = (await criarGrupo("Fut dos Amigos")).id;
    await entrarNoGrupo(privado, alvo.jogador);

    const dados = await carregarPerfil(
      { playerId: admin.jogador.id, isPlatformAdmin: true },
      await perfilDe(alvo.jogador),
      undefined,
    );

    expect(dados.gruposVisiveis.map((g) => g.id)).toContain(privado);
  });

  it("traz o papel do ALVO no grupo, não o do visitante", async () => {
    const alvo = await criarJogadorComConta();
    const visitante = await criarJogadorComConta();
    const grupo = (await criarGrupo("Pelada Aberta", { visibility: "public" })).id;
    await entrarNoGrupo(grupo, alvo.jogador, "admin");
    await entrarNoGrupo(grupo, visitante.jogador, "member");

    const dados = await carregarPerfil(
      visitanteComum(visitante.jogador.id),
      await perfilDe(alvo.jogador),
      undefined,
    );

    expect(dados.gruposVisiveis.find((g) => g.id === grupo)?.papel).toBe("admin");
  });
});

describe("carregarPerfil: o que o ?grupo= aceita", () => {
  it("grupo de que o visitante também participa liga o escopo e o MVP", async () => {
    const alvo = await criarJogadorComConta();
    const visitante = await criarJogadorComConta();
    const grupo = (await criarGrupo("Pelada Aberta", { visibility: "public" })).id;
    await entrarNoGrupo(grupo, alvo.jogador);
    await entrarNoGrupo(grupo, visitante.jogador);

    const dados = await carregarPerfil(
      visitanteComum(visitante.jogador.id),
      await perfilDe(alvo.jogador),
      String(grupo),
    );

    expect(dados.grupoSelecionado?.id).toBe(grupo);
    expect(dados.numeros.titulosMvp).toBe(0);
  });

  // Ver o grupo e ler o ranking dele são perguntas diferentes: /grupo/[slug]
  // abre para qualquer um se o grupo é público, /grupo/[slug]/ranking só para
  // membro. Sem esta linha, o `?grupo=` era o ranking daquele grupo servido um
  // jogador por vez, percorrendo a lista de membros que a página pública mostra.
  it("grupo público de que o visitante NÃO participa aparece na lista mas não filtra", async () => {
    const alvo = await criarJogadorComConta();
    const deFora = await criarJogadorComConta();
    const publico = (await criarGrupo("Pelada Aberta", { visibility: "public" })).id;
    await entrarNoGrupo(publico, alvo.jogador);

    const dados = await carregarPerfil(
      visitanteComum(deFora.jogador.id),
      await perfilDe(alvo.jogador),
      String(publico),
    );

    expect(dados.gruposVisiveis.map((g) => g.id)).toContain(publico);
    expect(dados.gruposFiltraveis).toEqual([]);
    expect(dados.grupoSelecionado).toBeNull();
    expect(dados.numeros.titulosMvp).toBeNull();
  });

  it("admin da plataforma filtra por grupo alheio, como enxerga o resto", async () => {
    const alvo = await criarJogadorComConta();
    const admin = await criarJogadorComConta();
    const privado = (await criarGrupo("Fut dos Amigos")).id;
    await entrarNoGrupo(privado, alvo.jogador);

    const dados = await carregarPerfil(
      { playerId: admin.jogador.id, isPlatformAdmin: true },
      await perfilDe(alvo.jogador),
      String(privado),
    );

    expect(dados.grupoSelecionado?.id).toBe(privado);
  });

  // Cair calado no geral, e não em 404: a página é legítima, só não pode
  // confirmar que aquele grupo existe nem que o alvo participa dele.
  it("grupo privado alheio cai no escopo geral, sem erro", async () => {
    const alvo = await criarJogadorComConta();
    const deFora = await criarJogadorComConta();
    const privado = (await criarGrupo("Fut dos Amigos")).id;
    await entrarNoGrupo(privado, alvo.jogador);

    const dados = await carregarPerfil(
      visitanteComum(deFora.jogador.id),
      await perfilDe(alvo.jogador),
      String(privado),
    );

    expect(dados.grupoSelecionado).toBeNull();
    expect(dados.numeros.titulosMvp).toBeNull();
  });

  it("grupo de que o alvo não participa cai no escopo geral", async () => {
    const alvo = await criarJogadorComConta();
    const visitante = await criarJogadorComConta();
    const soDoVisitante = (await criarGrupo("Outro Fut", { visibility: "public" })).id;
    await entrarNoGrupo(soDoVisitante, visitante.jogador);

    const dados = await carregarPerfil(
      visitanteComum(visitante.jogador.id),
      await perfilDe(alvo.jogador),
      String(soDoVisitante),
    );

    expect(dados.grupoSelecionado).toBeNull();
  });

  it("valor que não é número cai no escopo geral", async () => {
    const alvo = await criarJogadorComConta();
    const visitante = await criarJogadorComConta();

    const dados = await carregarPerfil(
      visitanteComum(visitante.jogador.id),
      await perfilDe(alvo.jogador),
      "'; drop table players; --",
    );

    expect(dados.grupoSelecionado).toBeNull();
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
      await perfilDe(alvo.jogador),
      undefined,
    );

    expect(dados.numeros).toMatchObject({
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

    const paraCada = async (jogador: Player) =>
      (await carregarPerfil(visitanteComum(visitante.jogador.id), await perfilDe(jogador), undefined))
        .numeros;

    expect(await paraCada(alvo.jogador)).toMatchObject({
      posicaoArtilharia: 1,
      empates: 1,
      aproveitamento: 0.5,
    });
    expect((await paraCada(rival.jogador)).posicaoArtilharia).toBe(1);
  });

  it("o filtro de grupo recorta os números, e o geral soma os dois futs", async () => {
    const alvo = await criarJogadorComConta();
    const rival = await criarJogadorComConta();
    const grupo = (await criarGrupo("Pelada Aberta", { visibility: "public" })).id;
    await entrarNoGrupo(grupo, alvo.jogador);
    await entrarNoGrupo(grupo, rival.jogador);
    await futEncerrado([{ jogador: alvo.jogador, gols: 3 }], [{ jogador: rival.jogador }], {
      groupId: grupo,
    });
    await futEncerrado([{ jogador: alvo.jogador, gols: 1 }], [{ jogador: rival.jogador }]);

    const visitante = visitanteComum(rival.jogador.id);
    const geral = await carregarPerfil(visitante, await perfilDe(alvo.jogador), undefined);
    const doGrupo = await carregarPerfil(visitante, await perfilDe(alvo.jogador), String(grupo));

    expect(geral.numeros).toMatchObject({ gols: 4, jogos: 2, presencas: 2, totalDays: 2 });
    expect(doGrupo.numeros).toMatchObject({ gols: 3, jogos: 1, presencas: 1, totalDays: 1 });
  });
});

// A vitrine é a única parte do perfil que NÃO tem filtro de privacidade, e é
// decisão: item exibido é vitrine — a pessoa pagou zenha para que os outros
// vejam, e escolheu item por item o que deixar à mostra.
describe("carregarPerfil: a vitrine", () => {
  it("perfil de quem não comprou nada vem vazio, sem nulo estranho", async () => {
    const alvo = await criarJogadorComConta();
    const visitante = await criarJogadorComConta();

    const dados = await carregarPerfil(visitanteComum(visitante.jogador.id), await perfilDe(alvo.jogador), undefined);

    expect(dados.vitrine).toEqual({
      moldura: null,
      corDoNome: null,
      titulo: null,
      badges: [],
    });
  });

  it("traz os três slots e os badges, na ordem das vagas", async () => {
    const alvo = await criarJogadorComConta();
    const visitante = await criarJogadorComConta();
    await creditarParaComprar(alvo.jogador.id, 5000);

    const moldura = await criarMoldura("Moldura de ouro", 10);
    const cor = await criarCorDoNome("Nome brasa", 10);
    const titulo = await criarTitulo("Camisa 10", 10);
    const primeiro = await criarBadge("Avaí", 10);
    const segundo = await criarBadge("Figueirense", 10);
    for (const item of [moldura, cor, titulo, primeiro, segundo]) {
      await comprar(alvo.jogador.id, item.id);
    }

    const dados = await carregarPerfil(visitanteComum(visitante.jogador.id), await perfilDe(alvo.jogador), undefined);

    // Comprar já equipa o slot vazio e já põe o badge na vitrine.
    expect(dados.vitrine.moldura?.cor).toBe(moldura.cor);
    expect(dados.vitrine.corDoNome?.nome).toBe("Nome brasa");
    expect(dados.vitrine.titulo?.nome).toBe("Camisa 10");
    expect(dados.vitrine.badges.map((b) => b.item.nome)).toEqual(["Avaí", "Figueirense"]);
    expect(dados.vitrine.badges.map((b) => b.destaque)).toEqual([true, false]);
  });

  it("badge guardado no inventário NÃO aparece no perfil", async () => {
    const alvo = await criarJogadorComConta();
    const visitante = await criarJogadorComConta();
    await creditarParaComprar(alvo.jogador.id, 1000);
    const badge = await criarBadge("Guardado", 10);
    await comprar(alvo.jogador.id, badge.id);
    const [linha] = await db
      .select()
      .from(zenhaInventario)
      .where(eq(zenhaInventario.playerId, alvo.jogador.id));
    await tirarDaVitrine(alvo.jogador.id, linha.id);

    const dados = await carregarPerfil(visitanteComum(visitante.jogador.id), await perfilDe(alvo.jogador), undefined);

    expect(dados.vitrine.badges).toEqual([]);
  });

  // A contrapartida de o admin poder tirar um item de venda sem apagá-lo: quem
  // comprou continua exibindo.
  it("item fora de venda continua desenhado no perfil de quem comprou", async () => {
    const alvo = await criarJogadorComConta();
    const visitante = await criarJogadorComConta();
    await creditarParaComprar(alvo.jogador.id, 1000);
    const badge = await criarBadge("Raro", 10);
    await comprar(alvo.jogador.id, badge.id);
    await db.update(lojaItens).set({ ativo: false }).where(eq(lojaItens.id, badge.id));

    const dados = await carregarPerfil(visitanteComum(visitante.jogador.id), await perfilDe(alvo.jogador), undefined);

    expect(dados.vitrine.badges.map((b) => b.item.nome)).toEqual(["Raro"]);
  });
});

describe("carregarPerfil: alvos fora do comum", () => {
  // "Não existe" deixou de ser resposta de `carregarPerfil` e passou a ser da
  // borda: a página traduz o slug em jogador e chama o notFound() ali. É por isso
  // que o teste agora pergunta ao `getJogadorPorSlug`, e não à camada de dados —
  // que só é chamada com um alvo que já existe.
  it("slug inexistente não resolve jogador nenhum", async () => {
    expect(await getJogadorPorSlug("nao-existe-esse-jogador")).toBeUndefined();
  });

  // A URL antiga era /jogador/{id}. Ela não pode virar um endereço vivo por
  // acaso: nenhum slug é puramente numérico (ver slugBase em src/lib/slug.ts).
  it("o id que era a URL antiga não casa com slug nenhum", async () => {
    const alguem = await criarJogadorComConta();

    expect(await getJogadorPorSlug(String(alguem.jogador.id))).toBeUndefined();
    expect(alguem.jogador.slug).not.toMatch(/^[0-9]+$/);
  });

  it("o próprio perfil carrega igual", async () => {
    const eu = await criarJogadorComConta();

    const dados = await carregarPerfil(visitanteComum(eu.jogador.id), await perfilDe(eu.jogador), undefined);

    expect(dados.jogador.id).toBe(eu.jogador.id);
    expect(dados.numeros.jogos).toBe(0);
    expect(dados.numeros.aproveitamento).toBeNull();
    expect(dados.numeros.posicaoArtilharia).toBe(0);
  });
});
