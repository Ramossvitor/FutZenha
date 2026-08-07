import { describe, expect, it } from "vitest";
import { posicoes } from "./posicao";

const gols = (n: number) => ({ gols: n });

describe("posicoes", () => {
  it("sem empate, é a ordem mesmo", () => {
    expect(posicoes([gols(9), gols(7), gols(4)], (x) => x.gols)).toEqual([1, 2, 3]);
  });

  it("empate divide a posição e o próximo pula", () => {
    // a regra do esporte: 1, 1, 3 — nunca 1, 1, 2
    expect(posicoes([gols(7), gols(7), gols(4)], (x) => x.gols)).toEqual([1, 1, 3]);
  });

  it("aguenta empate triplo e empate no meio", () => {
    expect(posicoes([gols(7), gols(7), gols(7), gols(2)], (x) => x.gols)).toEqual([1, 1, 1, 4]);
    expect(posicoes([gols(9), gols(5), gols(5), gols(1)], (x) => x.gols)).toEqual([1, 2, 2, 4]);
  });

  it("todo mundo empatado fica tudo em primeiro", () => {
    expect(posicoes([gols(3), gols(3), gols(3)], (x) => x.gols)).toEqual([1, 1, 1]);
  });

  it("lista vazia e lista de um", () => {
    expect(posicoes([], (x: { gols: number }) => x.gols)).toEqual([]);
    expect(posicoes([gols(1)], (x) => x.gols)).toEqual([1]);
  });

  it("serve para nota, que empata com casa decimal", () => {
    const notas = [{ n: 7.8 }, { n: 6.4 }, { n: 6.4 }, { n: 6.1 }];
    expect(posicoes(notas, (x) => x.n)).toEqual([1, 2, 2, 4]);
  });
});
