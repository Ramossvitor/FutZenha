import { describe, expect, it } from "vitest";
import { drawTeams, type DrawPlayer } from "./draw";

// PRNG determinístico (mulberry32) para testes reproduzíveis.
function seededRng(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let nextId = 1;
function player(skill: number, isGoalkeeper = false): DrawPlayer {
  const id = nextId++;
  return { id, name: `Jogador ${id}`, skill, isGoalkeeper };
}

function makePlayers(skills: number[], gkSkills: number[] = []): DrawPlayer[] {
  return [...skills.map((s) => player(s)), ...gkSkills.map((s) => player(s, true))];
}

describe("drawTeams", () => {
  it("rejeita menos de 2 times ou jogadores insuficientes", () => {
    expect(() => drawTeams(makePlayers([5]), 1)).toThrow();
    expect(() => drawTeams(makePlayers([5, 5]), 3)).toThrow();
  });

  it("divide 10 jogadores em 2 times de 5", () => {
    const teams = drawTeams(makePlayers([9, 8, 7, 6, 5, 5, 4, 3, 2, 1]), 2, seededRng(1));
    expect(teams).toHaveLength(2);
    expect(teams[0].players).toHaveLength(5);
    expect(teams[1].players).toHaveLength(5);
  });

  it("com número ímpar, tamanhos diferem em no máximo 1", () => {
    const teams = drawTeams(makePlayers([9, 8, 7, 6, 5, 4, 3]), 2, seededRng(2));
    const sizes = teams.map((t) => t.players.length).sort();
    expect(sizes).toEqual([3, 4]);
  });

  it("distribui 1 goleiro por time quando há goleiros suficientes", () => {
    const teams = drawTeams(makePlayers([9, 8, 7, 6, 5, 4, 3, 2, 1, 5, 6, 7], [5, 4, 3]), 3, seededRng(3));
    for (const team of teams) {
      expect(team.players.filter((p) => p.isGoalkeeper)).toHaveLength(1);
      expect(team.players).toHaveLength(5);
    }
  });

  it("goleiros excedentes viram jogadores de linha", () => {
    const teams = drawTeams(makePlayers([9, 8, 7, 6], [5, 4, 3, 2]), 2, seededRng(4));
    const totalGks = teams.flatMap((t) => t.players).filter((p) => p.isGoalkeeper).length;
    expect(totalGks).toBe(4);
    expect(teams[0].players).toHaveLength(4);
    expect(teams[1].players).toHaveLength(4);
  });

  it("balanceia as somas de nota (diferença pequena)", () => {
    const skills = [10, 9, 9, 8, 7, 7, 6, 5, 5, 4, 3, 3, 2, 1];
    for (let seed = 0; seed < 20; seed++) {
      const teams = drawTeams(makePlayers(skills), 2, seededRng(seed));
      const diff = Math.abs(teams[0].skillSum - teams[1].skillSum);
      expect(diff).toBeLessThanOrEqual(2);
    }
  });

  it("não perde nem duplica jogador", () => {
    const input = makePlayers([9, 8, 7, 6, 5, 4, 3, 2, 1, 5, 6], [7, 2]);
    const teams = drawTeams(input, 3, seededRng(7));
    const ids = teams
      .flatMap((t) => t.players)
      .map((p) => p.id)
      .sort((a, b) => a - b);
    expect(ids).toEqual(input.map((p) => p.id).sort((a, b) => a - b));
  });

  it("re-sorteio com rng diferente gera composições diferentes", () => {
    const input = makePlayers([5, 5, 5, 5, 5, 5, 5, 5, 5, 5]);
    const key = (teams: ReturnType<typeof drawTeams>) =>
      teams.map((t) => t.players.map((p) => p.id).sort((a, b) => a - b).join(",")).join("|");
    const results = new Set(
      Array.from({ length: 10 }, (_, seed) => key(drawTeams(input, 2, seededRng(seed)))),
    );
    expect(results.size).toBeGreaterThan(1);
  });

  it("skillSum bate com a soma real dos jogadores do time", () => {
    const teams = drawTeams(makePlayers([9, 8, 7, 6, 5, 4], [5, 3]), 2, seededRng(9));
    for (const team of teams) {
      expect(team.skillSum).toBe(team.players.reduce((acc, p) => acc + p.skill, 0));
    }
  });
});
