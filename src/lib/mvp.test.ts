import { describe, expect, it } from "vitest";
import { apurarMvp, contarTitulos, type CandidatoApurado } from "./mvp";

const candidato = (
  playerId: number,
  votos: number,
  mediaMeias: number | null = null,
): CandidatoApurado => ({ playerId, votos, mediaMeias });

describe("apurarMvp", () => {
  it("o mais votado vence sozinho, sem olhar a média", () => {
    expect(
      apurarMvp([candidato(1, 3, 4), candidato(2, 2, 10), candidato(3, 1, 10)]),
    ).toEqual([1]);
  });

  it("ninguém votou = fut sem MVP", () => {
    expect(apurarMvp([])).toEqual([]);
    expect(apurarMvp([candidato(1, 0, 9)])).toEqual([]);
  });

  it("um voto só fica abaixo do piso — publicar seria expor o voto do único eleitor", () => {
    expect(apurarMvp([candidato(1, 1, 9)])).toEqual([]);
    // Dois votos contados é o piso, mesmo que num candidato só.
    expect(apurarMvp([candidato(1, 2, 9)])).toEqual([1]);
  });

  it("empate de votos é decidido pela maior média de meias-estrelas da rodada", () => {
    expect(
      apurarMvp([candidato(1, 2, 7.5), candidato(2, 2, 9), candidato(3, 1, 10)]),
    ).toEqual([2]);
  });

  it("empate até na média divide o título", () => {
    expect(
      apurarMvp([candidato(1, 2, 8), candidato(2, 2, 8), candidato(3, 2, 7)]),
    ).toEqual([1, 2]);
  });

  it("quem não recebeu avaliação perde o desempate de qualquer média real", () => {
    // Votado que jogou num lado sem grupo mínimo: tem voto, não tem média.
    expect(apurarMvp([candidato(1, 2, null), candidato(2, 2, 2)])).toEqual([2]);
  });

  it("todos sem média empatam entre si e dividem", () => {
    expect(apurarMvp([candidato(2, 1, null), candidato(1, 1, null)])).toEqual([1, 2]);
  });
});

describe("contarTitulos", () => {
  it("soma os títulos por jogador através das rodadas", () => {
    const titulos = contarTitulos([[1], [2], [1]]);
    expect(titulos.get(1)).toBe(2);
    expect(titulos.get(2)).toBe(1);
  });

  it("título dividido conta inteiro para todos os empatados", () => {
    const titulos = contarTitulos([[1, 2], [1]]);
    expect(titulos.get(1)).toBe(2);
    expect(titulos.get(2)).toBe(1);
  });

  it("rodada sem MVP não conta para ninguém", () => {
    expect(contarTitulos([[], []]).size).toBe(0);
  });
});
