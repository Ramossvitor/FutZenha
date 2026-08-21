import { describe, expect, it } from "vitest";
import { linhaDePlacar, montarResumo, type EntradaDoResumo } from "./resumo";

// Dois times, um jogo, dois jogadores de cada lado — a base que cada teste
// deforma no ponto que quer provar.
const VERDE = { id: 1, name: "Verde", sortOrder: 0 };
const AZUL = { id: 2, name: "Azul", sortOrder: 1 };

const JOGO = {
  id: 10,
  teamAId: VERDE.id,
  teamBId: AZUL.id,
  scoreA: 2,
  scoreB: 1,
  sortOrder: 0,
  startedAt: null,
  finishedAt: null,
};

function entrada(parcial: Partial<EntradaDoResumo> = {}): EntradaDoResumo {
  return {
    times: [VERDE, AZUL],
    jogos: [JOGO],
    gols: [],
    escalacao: [
      { gameId: 10, playerId: 100, side: "A" },
      { gameId: 10, playerId: 200, side: "B" },
    ],
    elencos: [],
    ...parcial,
  };
}

function gol(parcial: Partial<EntradaDoResumo["gols"][number]> = {}) {
  return {
    gameId: 10,
    playerId: 100,
    playerName: "João",
    nickname: null,
    quantity: 1,
    side: null,
    ...parcial,
  };
}

describe("montarResumo — placar e jogos", () => {
  it("agrupa os gols no jogo a que pertencem", () => {
    const resumo = montarResumo(
      entrada({
        jogos: [JOGO, { ...JOGO, id: 11, sortOrder: 1, scoreA: 0, scoreB: 3 }],
        gols: [gol(), gol({ gameId: 11, playerId: 200, playerName: "Pedro" })],
      }),
    );

    expect(resumo.jogos.map((j) => j.id)).toEqual([10, 11]);
    expect(resumo.jogos[0].gols.map((g) => g.autor)).toEqual(["João"]);
    expect(resumo.jogos[1].gols.map((g) => g.autor)).toEqual(["Pedro"]);
  });

  // A ordem não pode depender de quem consultou o banco: a função é total, e é
  // ela que responde por "o primeiro jogo do dia veio primeiro".
  it("ordena por sortOrder e desempata por id, seja qual for a ordem da entrada", () => {
    const resumo = montarResumo(
      entrada({
        jogos: [
          { ...JOGO, id: 30, sortOrder: 2 },
          { ...JOGO, id: 12, sortOrder: 1 },
          { ...JOGO, id: 11, sortOrder: 1 },
        ],
      }),
    );

    expect(resumo.jogos.map((j) => j.id)).toEqual([11, 12, 30]);
  });

  it("leva o placar e o nome dos dois times", () => {
    const [jogo] = montarResumo(entrada()).jogos;
    expect(jogo).toMatchObject({ timeA: "Verde", timeB: "Azul", placarA: 2, placarB: 1 });
  });

  it("em andamento é começou-e-não-terminou; jogo do fluxo clássico nunca é", () => {
    const rodando = montarResumo(
      entrada({ jogos: [{ ...JOGO, startedAt: new Date(), finishedAt: null }] }),
    );
    const encerrado = montarResumo(
      entrada({ jogos: [{ ...JOGO, startedAt: new Date(), finishedAt: new Date() }] }),
    );

    expect(rodando.jogos[0].emAndamento).toBe(true);
    expect(encerrado.jogos[0].emAndamento).toBe(false);
    expect(montarResumo(entrada()).jogos[0].emAndamento).toBe(false);
  });

  it("fut sem jogo devolve resumo vazio, não quebra", () => {
    const resumo = montarResumo(entrada({ jogos: [], escalacao: [] }));
    expect(resumo.jogos).toEqual([]);
    expect(resumo.totalDeGols).toBe(0);
    expect(resumo.artilheiros).toEqual([]);
  });
});

describe("montarResumo — o colete de cada gol", () => {
  it("sai da escalação DAQUELE jogo, que é quem sabe o lado", () => {
    const resumo = montarResumo(entrada({ gols: [gol({ playerId: 200 })] }));
    expect(resumo.jogos[0].gols[0].time).toBe("Azul");
  });

  // A mesma pessoa pode trocar de colete entre jogos — por isso a chave é o par
  // (jogo, jogador), e não o jogador sozinho.
  it("acompanha quem trocou de lado de um jogo para o outro", () => {
    const resumo = montarResumo(
      entrada({
        jogos: [JOGO, { ...JOGO, id: 11, sortOrder: 1 }],
        escalacao: [
          { gameId: 10, playerId: 100, side: "A" },
          { gameId: 11, playerId: 100, side: "B" },
        ],
        gols: [gol(), gol({ gameId: 11 })],
      }),
    );

    expect(resumo.jogos[0].gols[0].time).toBe("Verde");
    expect(resumo.jogos[1].gols[0].time).toBe("Azul");
  });

  it("sem linha de escalação, cai no side que a súmula gravou", () => {
    const resumo = montarResumo(entrada({ gols: [gol({ playerId: 999, side: "B" })] }));
    expect(resumo.jogos[0].gols[0].time).toBe("Azul");
  });

  it("gol contra / sem autor usa o side, e o autor fica nulo", () => {
    const resumo = montarResumo(
      entrada({ gols: [gol({ playerId: null, playerName: null, side: "A" })] }),
    );
    expect(resumo.jogos[0].gols[0]).toMatchObject({ autor: null, time: "Verde" });
  });

  // Chip neutro é mais honesto do que chutar um lado.
  it("sem escalação e sem side, o colete fica vazio", () => {
    const resumo = montarResumo(entrada({ gols: [gol({ playerId: 999, side: null })] }));
    expect(resumo.jogos[0].gols[0].time).toBe("");
  });
});

describe("montarResumo — artilharia e elencos", () => {
  it("soma os gols da mesma pessoa entre jogos diferentes", () => {
    const resumo = montarResumo(
      entrada({
        jogos: [JOGO, { ...JOGO, id: 11, sortOrder: 1 }],
        gols: [gol({ quantity: 2 }), gol({ gameId: 11, quantity: 1 })],
      }),
    );

    expect(resumo.artilheiros).toEqual([{ playerId: 100, rotulo: "João", gols: 3 }]);
    expect(resumo.totalDeGols).toBe(3);
  });

  it("ordena por gols e desempata por nome", () => {
    const resumo = montarResumo(
      entrada({
        gols: [
          gol({ playerId: 1, playerName: "Zé", quantity: 1 }),
          gol({ playerId: 2, playerName: "Ana", quantity: 1 }),
          gol({ playerId: 3, playerName: "Bia", quantity: 5 }),
        ],
      }),
    );

    expect(resumo.artilheiros.map((a) => a.rotulo)).toEqual(["Bia", "Ana", "Zé"]);
  });

  // Gol contra conta no placar, mas não tem a quem creditar.
  it("gol sem autor entra no total e fica fora da artilharia", () => {
    const resumo = montarResumo(
      entrada({ gols: [gol({ playerId: null, playerName: null, quantity: 2 })] }),
    );
    expect(resumo.totalDeGols).toBe(2);
    expect(resumo.artilheiros).toEqual([]);
  });

  it("o apelido vence o nome, no gol e no elenco", () => {
    const resumo = montarResumo(
      entrada({
        gols: [gol({ nickname: "Jô" })],
        elencos: [
          { teamId: 1, playerId: 100, name: "João", nickname: "Jô", isGoalkeeper: false },
        ],
      }),
    );

    expect(resumo.jogos[0].gols[0].autor).toBe("Jô");
    expect(resumo.artilheiros[0].rotulo).toBe("Jô");
    expect(resumo.times[0].jogadores[0].rotulo).toBe("Jô");
  });

  it("cada elenco fica no seu time, em ordem alfabética", () => {
    const resumo = montarResumo(
      entrada({
        elencos: [
          { teamId: 2, playerId: 200, name: "Pedro", nickname: null, isGoalkeeper: true },
          { teamId: 1, playerId: 101, name: "Zé", nickname: null, isGoalkeeper: false },
          { teamId: 1, playerId: 100, name: "Ana", nickname: null, isGoalkeeper: false },
        ],
      }),
    );

    expect(resumo.times.map((t) => t.nome)).toEqual(["Verde", "Azul"]);
    expect(resumo.times[0].jogadores.map((j) => j.rotulo)).toEqual(["Ana", "Zé"]);
    expect(resumo.times[1].jogadores[0].isGoalkeeper).toBe(true);
  });

});

describe("linhaDePlacar", () => {
  it("resume em uma linha, no plural certo", () => {
    const doisJogos = montarResumo(
      entrada({
        jogos: [JOGO, { ...JOGO, id: 11, sortOrder: 1 }],
        gols: [gol({ quantity: 3 })],
      }),
    );
    expect(linhaDePlacar(doisJogos)).toBe("2 jogos · 3 gols");
  });

  it("singular quando é um só", () => {
    expect(linhaDePlacar(montarResumo(entrada({ gols: [gol()] })))).toBe("1 jogo · 1 gol");
  });

  it("fut sem bola rolando ainda tem linha", () => {
    expect(linhaDePlacar(montarResumo(entrada({ jogos: [] })))).toBe("0 jogos · 0 gols");
  });
});
