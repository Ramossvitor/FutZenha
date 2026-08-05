import { describe, expect, it } from "vitest";
import { companheirosPorJogador, type EscalacaoRow } from "./lineup";

// Atalho: "1A" = jogador 1 no lado A do jogo informado.
function escalacao(gameId: number, ladoA: number[], ladoB: number[]): EscalacaoRow[] {
  return [
    ...ladoA.map((playerId) => ({ gameId, playerId, side: "A" as const })),
    ...ladoB.map((playerId) => ({ gameId, playerId, side: "B" as const })),
  ];
}

const lista = (m: Map<number, Set<number>>, playerId: number) =>
  [...(m.get(playerId) ?? [])].sort((a, b) => a - b);

describe("companheirosPorJogador", () => {
  it("sem escalação, mapa vazio", () => {
    expect(companheirosPorJogador([]).size).toBe(0);
  });

  it("só junta quem estava do mesmo lado", () => {
    const m = companheirosPorJogador(escalacao(1, [1, 2, 3], [4, 5, 6]));
    expect(lista(m, 1)).toEqual([2, 3]);
    expect(lista(m, 4)).toEqual([5, 6]);
  });

  it("nunca inclui o próprio jogador", () => {
    const m = companheirosPorJogador(escalacao(1, [1, 2], [3, 4]));
    for (const [playerId, conjunto] of m) {
      expect(conjunto.has(playerId)).toBe(false);
    }
  });

  // O caso que motiva a tabela game_players: times diferentes por jogo.
  it("une os companheiros de todos os jogos do dia", () => {
    const m = companheirosPorJogador([
      ...escalacao(1, [1, 2, 3], [4, 5, 6]),
      ...escalacao(2, [1, 4, 5], [2, 3, 6]),
    ]);
    // O jogador 1 jogou com 2 e 3 no primeiro jogo, com 4 e 5 no segundo.
    expect(lista(m, 1)).toEqual([2, 3, 4, 5]);
    expect(lista(m, 6)).toEqual([2, 3, 4, 5]);
  });

  it("quem jogou junto em vários jogos conta uma vez só", () => {
    const m = companheirosPorJogador([
      ...escalacao(1, [1, 2], [3, 4]),
      ...escalacao(2, [1, 2], [3, 4]),
      ...escalacao(3, [1, 2], [3, 4]),
    ]);
    expect(lista(m, 1)).toEqual([2]);
  });

  it("adversário em um jogo e companheiro em outro entra na lista", () => {
    const m = companheirosPorJogador([
      ...escalacao(1, [1], [2]),
      ...escalacao(2, [1, 2], []),
    ]);
    expect(lista(m, 1)).toEqual([2]);
  });

  it("jogador sozinho no lado aparece com conjunto vazio", () => {
    const m = companheirosPorJogador(escalacao(1, [1], [2, 3]));
    expect(m.has(1)).toBe(true);
    expect(lista(m, 1)).toEqual([]);
    expect(lista(m, 2)).toEqual([3]);
  });

  it("quem não entrou em nenhum jogo não aparece no mapa", () => {
    const m = companheirosPorJogador(escalacao(1, [1, 2], [3, 4]));
    expect(m.has(99)).toBe(false);
  });

  it("a ordem das linhas não muda o resultado", () => {
    const rows = [...escalacao(1, [1, 2, 3], [4, 5]), ...escalacao(2, [1, 4], [2, 3, 5])];
    const direto = companheirosPorJogador(rows);
    const invertido = companheirosPorJogador([...rows].reverse());
    for (const playerId of direto.keys()) {
      expect(lista(invertido, playerId)).toEqual(lista(direto, playerId));
    }
    expect(invertido.size).toBe(direto.size);
  });
});
