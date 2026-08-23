import { describe, expect, it } from "vitest";
import {
  ladoPorJogadorDe,
  lerLadosDoForm,
  lerRascunho,
  repartirEmColunas,
  SEM_TIME,
  serializarRascunho,
  somaDeNotas,
  type JogadorDeTime,
} from "./montar-times";

const j = (playerId: number, nome: string, skill = 5): JogadorDeTime => ({
  playerId,
  nome,
  skill,
  isGoalkeeper: false,
});

const TIMES = [
  { chave: "10", nome: "Preto" },
  { chave: "11", nome: "Branco" },
];

describe("repartirEmColunas", () => {
  it("põe 'Sem time' primeiro, mesmo vazio, e cada um na sua coluna", () => {
    const colunas = repartirEmColunas(
      [j(1, "Ana"), j(2, "Bia"), j(3, "Caio")],
      TIMES,
      new Map([
        [1, "10"],
        [2, "11"],
        [3, "10"],
      ]),
    );
    expect(colunas.map((c) => c.nome)).toEqual([SEM_TIME, "Preto", "Branco"]);
    expect(colunas[0].jogadores).toEqual([]);
    expect(colunas[1].jogadores.map((x) => x.playerId)).toEqual([1, 3]);
    expect(colunas[2].jogadores.map((x) => x.playerId)).toEqual([2]);
  });

  it("quem não tem lado — ou aponta para time que não existe — cai em 'Sem time'", () => {
    const colunas = repartirEmColunas(
      [j(1, "Ana"), j(2, "Bia")],
      TIMES,
      new Map([[2, "99"]]),
    );
    expect(colunas[0].jogadores.map((x) => x.playerId)).toEqual([1, 2]);
  });

  it("ordena cada coluna por nome, como o servidor", () => {
    const colunas = repartirEmColunas(
      [j(1, "Caio"), j(2, "Ana"), j(3, "Bia")],
      TIMES,
      new Map(),
    );
    expect(colunas[0].jogadores.map((x) => x.nome)).toEqual([
      "Ana",
      "Bia",
      "Caio",
    ]);
  });

  it("não perde nem duplica ninguém ao reaplicar um movimento", () => {
    const jogadores = [j(1, "Ana"), j(2, "Bia"), j(3, "Caio")];
    const antes = repartirEmColunas(jogadores, TIMES, new Map([[1, "10"]]));
    const mapa = ladoPorJogadorDe(antes);
    mapa.set(1, "11");
    mapa.set(3, null);
    const depois = repartirEmColunas(jogadores, TIMES, mapa);
    expect(depois[1].jogadores).toEqual([]);
    expect(depois[2].jogadores.map((x) => x.playerId)).toEqual([1]);
    expect(
      depois
        .flatMap((c) => c.jogadores)
        .map((x) => x.playerId)
        .sort(),
    ).toEqual([1, 2, 3]);
  });
});

describe("ladoPorJogadorDe", () => {
  it("é o inverso de repartirEmColunas", () => {
    const mapa = new Map<number, string | null>([
      [1, "10"],
      [2, null],
    ]);
    const colunas = repartirEmColunas([j(1, "Ana"), j(2, "Bia")], TIMES, mapa);
    expect(ladoPorJogadorDe(colunas)).toEqual(mapa);
  });
});

describe("somaDeNotas", () => {
  it("soma em centésimos, sem ruído de ponto flutuante", () => {
    expect(somaDeNotas([j(1, "a", 7.1), j(2, "b", 7.3), j(3, "c", 20)])).toBe(
      34.4,
    );
    expect(somaDeNotas([])).toBe(0);
  });
});

describe("rascunho no browser", () => {
  it("vai e volta, guardando só quem tem lado", () => {
    const mapa = new Map<number, string | null>([
      [1, "A"],
      [2, null],
      [3, "B"],
    ]);
    const salvo = serializarRascunho(mapa);
    expect(JSON.parse(salvo)).toEqual({ "1": "A", "3": "B" });
    expect([...lerRascunho(salvo).entries()]).toEqual([
      [1, "A"],
      [3, "B"],
    ]);
  });

  it("tolera storage vazio, JSON corrompido e formato estranho", () => {
    expect(lerRascunho(null).size).toBe(0);
    expect(lerRascunho("{nope").size).toBe(0);
    expect(lerRascunho("[1,2]").size).toBe(0);
    expect(lerRascunho('{"x":"A","2":7,"3":"B"}').size).toBe(1);
  });
});

describe("lerLadosDoForm", () => {
  it("lê A/B de quem está confirmado e aponta quem ficou sem lado", () => {
    const f = new FormData();
    f.set("lado-1", "A");
    f.set("lado-2", "B");
    f.set("lado-3", "C"); // valor inválido
    const { lados, semLado } = lerLadosDoForm(f, [1, 2, 3, 4]);
    expect([...lados.entries()]).toEqual([
      [1, "A"],
      [2, "B"],
    ]);
    expect(semLado).toEqual([3, 4]);
  });

  it("ignora id que não está na lista de confirmados", () => {
    const f = new FormData();
    f.set("lado-1", "A");
    f.set("lado-77", "B");
    const { lados, semLado } = lerLadosDoForm(f, [1]);
    expect(lados.has(77)).toBe(false);
    expect(semLado).toEqual([]);
  });
});
