import { describe, expect, it } from "vitest";
import { replaySkills, type RatingInput, type RoundInput } from "./skill";

// Helpers: os ids dos avaliadores não importam para a nota, só a contagem —
// então geramos avaliadores distintos automaticamente.
function recebe(ratedPlayerId: number, estrelas: number[], offset = 1000): RatingInput[] {
  return estrelas.map((stars, i) => ({
    raterPlayerId: offset + i,
    ratedPlayerId,
    stars,
  }));
}

function rodada(roundId: number, ratings: RatingInput[], date?: string): RoundInput {
  return {
    roundId,
    matchDayId: roundId,
    matchDayDate: date ?? `2026-03-${String(roundId).padStart(2, "0")}`,
    ratings,
  };
}

const notaDe = (r: ReturnType<typeof replaySkills>, playerId: number) =>
  r.skillByPlayer.get(playerId);

describe("replaySkills", () => {
  it("sem rodadas, não produz nota nem histórico", () => {
    const r = replaySkills([]);
    expect(r.skillByPlayer.size).toBe(0);
    expect(r.history).toEqual([]);
  });

  // 3× 5★ = 10,0 recebido. nova = (2 × 5,0 + 10,0) / 3 = 6,666… → 6,7
  it("três 5★ levam a nota de 5,0 para 6,7", () => {
    const r = replaySkills([rodada(1, recebe(1, [5, 5, 5]))]);
    expect(notaDe(r, 1)).toBe(6.7);
    expect(r.history).toEqual([
      {
        playerId: 1,
        roundId: 1,
        before: 5,
        after: 6.7,
        ratingsCount: 3,
        averageReceived: 10,
      },
    ]);
  });

  // 4★ = 7,75 e 3★ = 5,5 → média 6,625 → 6,63 (meio-para-cima).
  // nova = (2 × 5,0 + 6,63) / 3 = 5,543… → 5,5
  it("mistura 4★ e 3★", () => {
    const r = replaySkills([rodada(1, recebe(1, [4, 3]))]);
    expect(r.history[0].averageReceived).toBe(6.63);
    expect(notaDe(r, 1)).toBe(5.5);
  });

  // (7,75 + 7,75 + 10,0) / 3 = 8,5 exato. nova = (10,0 + 8,5) / 3 = 6,166… → 6,2
  it("média com dízima na soma das estrelas", () => {
    const r = replaySkills([rodada(1, recebe(1, [4, 4, 5]))]);
    expect(r.history[0].averageReceived).toBe(8.5);
    expect(notaDe(r, 1)).toBe(6.2);
  });

  // (1,0 + 3,25) / 2 = 2,125 → 2,13 no meio-para-cima (2,12 se fosse par).
  it("arredonda a média recebida meio-para-cima", () => {
    const r = replaySkills([rodada(1, recebe(1, [1, 2]))]);
    expect(r.history[0].averageReceived).toBe(2.13);
  });

  // 2★+3★ = (3,25 + 5,5) / 2 = 4,375 → 4,38.
  it("empate exato de arredondamento não perde centésimo", () => {
    const r = replaySkills([rodada(1, recebe(1, [2, 3]))]);
    expect(r.history[0].averageReceived).toBe(4.38);
  });

  it("quem não recebeu avaliação válida fica de fora do histórico", () => {
    // Jogador 2 só avalia, nunca é avaliado.
    const r = replaySkills([
      rodada(1, [{ raterPlayerId: 2, ratedPlayerId: 1, stars: 5 }]),
    ]);
    expect(r.history.map((h) => h.playerId)).toEqual([1]);
    expect(notaDe(r, 2)).toBeUndefined();
  });

  it("rodada sem nenhuma avaliação válida não muda nada", () => {
    const r = replaySkills([rodada(1, [])]);
    expect(r.skillByPlayer.size).toBe(0);
    expect(r.history).toEqual([]);
  });

  it("é invariante à ordem em que as rodadas chegam", () => {
    const rodadas = [
      rodada(1, recebe(1, [5, 5, 4]), "2026-03-01"),
      rodada(2, recebe(1, [2, 3, 3]), "2026-03-08"),
      rodada(3, recebe(1, [4, 4, 4]), "2026-03-15"),
    ];
    const naOrdem = replaySkills(rodadas);
    const embaralhado = replaySkills([rodadas[2], rodadas[0], rodadas[1]]);
    expect(embaralhado.history).toEqual(naOrdem.history);
    expect([...embaralhado.skillByPlayer]).toEqual([...naOrdem.skillByPlayer]);
  });

  it("ordena pela data da pelada, não pelo id da rodada", () => {
    // Rodada 2 é de uma pelada ANTERIOR à rodada 1 — tem que ser aplicada antes.
    const cronologico = replaySkills([
      rodada(9, recebe(1, [5, 5, 5]), "2026-03-01"),
      rodada(1, recebe(1, [1, 1, 1]), "2026-03-08"),
    ]);
    expect(cronologico.history.map((h) => h.roundId)).toEqual([9, 1]);
    expect(cronologico.history[0].before).toBe(5);
  });

  // O caso da denúncia aceita: some uma avaliação antiga e tudo depois dela
  // precisa ser recalculado em cadeia.
  it("descartar uma avaliação da rodada 1 muda o resultado da rodada 2", () => {
    // A terceira avaliação é o 1★ do troll.
    const r1 = rodada(1, recebe(1, [5, 5, 1]), "2026-03-01");
    const r2 = rodada(2, recebe(1, [4, 4, 4], 2000), "2026-03-08");

    const completo = replaySkills([r1, r2]);
    expect(completo.history.map((h) => h.after)).toEqual([5.7, 6.4]);

    const semOTroll = replaySkills([{ ...r1, ratings: r1.ratings.slice(0, 2) }, r2]);
    expect(semOTroll.history.map((h) => h.after)).toEqual([6.7, 7.1]);
  });

  it("é idempotente: rodar duas vezes dá o mesmo resultado", () => {
    const rodadas = [rodada(1, recebe(1, [5, 4, 3])), rodada(2, recebe(1, [2, 2, 5], 2000))];
    const a = replaySkills(rodadas);
    const b = replaySkills(rodadas);
    expect(b.history).toEqual(a.history);
    expect([...b.skillByPlayer]).toEqual([...a.skillByPlayer]);
  });

  // Arredondando para uma casa, a recorrência trava antes dos extremos: 9,9 com
  // 5★ unânime e 1,1 com 1★ unânime. 10,0 e 1,0 são inalcançáveis pela fórmula.
  it("converge para 9,9 com 5★ unânime e estabiliza sem oscilar", () => {
    const rodadas = Array.from({ length: 40 }, (_, i) =>
      rodada(i + 1, recebe(1, [5, 5, 5], 1000 + i * 10)),
    );
    const r = replaySkills(rodadas);
    expect(notaDe(r, 1)).toBe(9.9);

    const estaveis = r.history.filter((h) => h.before === 9.9);
    expect(estaveis.length).toBeGreaterThan(20);
    expect(estaveis.every((h) => h.after === 9.9)).toBe(true);
  });

  it("converge para 1,1 com 1★ unânime", () => {
    const r = replaySkills(
      Array.from({ length: 40 }, (_, i) => rodada(i + 1, recebe(1, [1, 1, 1], 1000 + i * 10))),
    );
    expect(notaDe(r, 1)).toBe(1.1);
  });

  it("a nota nunca sai da faixa [1,0; 10,0]", () => {
    const rodadas = Array.from({ length: 40 }, (_, i) =>
      rodada(i + 1, recebe(1, i % 2 === 0 ? [5, 5, 5] : [1, 1, 1], 1000 + i * 10)),
    );
    for (const h of replaySkills(rodadas).history) {
      expect(h.after).toBeGreaterThanOrEqual(1);
      expect(h.after).toBeLessThanOrEqual(10);
    }
  });

  it("jogador que só aparece numa rodada tardia começa de 5,0", () => {
    const r = replaySkills([
      rodada(1, recebe(1, [5, 5, 5]), "2026-03-01"),
      rodada(2, recebe(1, [5, 5, 5], 2000), "2026-03-08"),
      rodada(3, [...recebe(1, [5, 5, 5], 3000), ...recebe(2, [5, 5, 5], 4000)], "2026-03-15"),
    ]);
    const primeiraDoDois = r.history.find((h) => h.playerId === 2)!;
    expect(primeiraDoDois.before).toBe(5);
    expect(primeiraDoDois.after).toBe(6.7);
  });

  it("recusa estrelas fora de 1–5", () => {
    expect(() => replaySkills([rodada(1, recebe(1, [0]))])).toThrow(/estrelas inválidas/);
    expect(() => replaySkills([rodada(1, recebe(1, [6]))])).toThrow(/estrelas inválidas/);
    expect(() => replaySkills([rodada(1, recebe(1, [3.5]))])).toThrow(/estrelas inválidas/);
  });

  it("recusa auto-avaliação", () => {
    expect(() =>
      replaySkills([rodada(1, [{ raterPlayerId: 7, ratedPlayerId: 7, stars: 5 }])]),
    ).toThrow(/a si mesmo/);
  });

  it("recusa o mesmo par duas vezes na mesma rodada", () => {
    expect(() =>
      replaySkills([
        rodada(1, [
          { raterPlayerId: 2, ratedPlayerId: 1, stars: 5 },
          { raterPlayerId: 2, ratedPlayerId: 1, stars: 1 },
        ]),
      ]),
    ).toThrow(/duplicada/);
  });

  it("aceita o mesmo par em rodadas diferentes", () => {
    const par = (stars: number) => [{ raterPlayerId: 2, ratedPlayerId: 1, stars }];
    expect(() =>
      replaySkills([rodada(1, par(5), "2026-03-01"), rodada(2, par(1), "2026-03-08")]),
    ).not.toThrow();
  });

  it("a nota nunca sai da grade de uma casa decimal", () => {
    const rodadas = Array.from({ length: 25 }, (_, i) =>
      rodada(i + 1, recebe(1, [1, 3, 4, 5, 2], 1000 + i * 10)),
    );
    const r = replaySkills(rodadas);
    for (const h of r.history) {
      expect(Math.round(h.after * 10) / 10).toBe(h.after);
      expect(Math.round(h.before * 10) / 10).toBe(h.before);
    }
  });

  it("o histórico sai ordenado por rodada e, dentro dela, por playerId", () => {
    const r = replaySkills([
      rodada(2, [...recebe(3, [5], 100), ...recebe(1, [5], 200)], "2026-03-08"),
      rodada(1, [...recebe(2, [5], 300), ...recebe(1, [5], 400)], "2026-03-01"),
    ]);
    expect(r.history.map((h) => [h.roundId, h.playerId])).toEqual([
      [1, 1],
      [1, 2],
      [2, 1],
      [2, 3],
    ]);
  });
});
