import { describe, expect, it } from "vitest";
import {
  centParaNota,
  diffNotas,
  notaParaCent,
  replaySkills,
  SKILL_INICIAL_CENT,
  SKILL_MAX_CENT,
  SKILL_MIN_CENT,
  type RatingInput,
  type RoundInput,
} from "./skill";

// Helpers: os ids dos avaliadores não importam para a nota, só a contagem —
// então geramos avaliadores distintos automaticamente. `meias` é a unidade do
// sistema: meias-estrelas inteiras (7 = 3,5★).
function recebe(ratedPlayerId: number, meias: number[], offset = 1000): RatingInput[] {
  return meias.map((halfStars, i) => ({
    raterPlayerId: offset + i,
    ratedPlayerId,
    halfStars,
  }));
}

function rodada(roundId: number, ratings: RatingInput[], date?: string): RoundInput {
  return {
    roundId,
    matchDayId: roundId,
    matchDayDate: date ?? `2026-03-${String(roundId).padStart(2, "0")}`,
    legacyScale: false,
    ratings,
  };
}

/** Rodada apurada antes da meia estrela: vale pela tabela congelada. */
function rodadaLegada(roundId: number, ratings: RatingInput[], date?: string): RoundInput {
  return { ...rodada(roundId, ratings, date), legacyScale: true };
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
    const r = replaySkills([rodada(1, recebe(1, [10, 10, 10]))]);
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

  // Na régua atual cada meia vale 1 ponto: 4★ = 8,0 e 3★ = 6,0 → média 7,0.
  // nova = (2 × 5,0 + 7,0) / 3 = 5,666… → 5,7
  it("mistura 4★ e 3★", () => {
    const r = replaySkills([rodada(1, recebe(1, [8, 6]))]);
    expect(r.history[0].averageReceived).toBe(7);
    expect(notaDe(r, 1)).toBe(5.7);
  });

  // (8,0 + 8,0 + 10,0) / 3 = 8,666… → 8,67. nova = (10,0 + 8,67) / 3 → 6,2
  it("média com dízima na soma das estrelas", () => {
    const r = replaySkills([rodada(1, recebe(1, [8, 8, 10]))]);
    expect(r.history[0].averageReceived).toBe(8.67);
    expect(notaDe(r, 1)).toBe(6.2);
  });

  // Sete 0,5★ e um 1★: 900 centésimos / 8 = 112,5 → 1,13 no meio-para-cima
  // (1,12 se fosse arredondamento do par).
  it("arredonda a média recebida meio-para-cima", () => {
    const r = replaySkills([rodada(1, recebe(1, [1, 1, 1, 1, 1, 1, 1, 2]))]);
    expect(r.history[0].averageReceived).toBe(1.13);
  });

  // (3,0 + 3,0 + 4,0) / 3 = 3,333… → 3,33 — a média guarda os centésimos.
  it("dízima da média não perde centésimo", () => {
    const r = replaySkills([rodada(1, recebe(1, [3, 3, 4]))]);
    expect(r.history[0].averageReceived).toBe(3.33);
    expect(notaDe(r, 1)).toBe(4.4);
  });

  it("quem não recebeu avaliação válida fica de fora do histórico", () => {
    // Jogador 2 só avalia, nunca é avaliado.
    const r = replaySkills([
      rodada(1, [{ raterPlayerId: 2, ratedPlayerId: 1, halfStars: 10 }]),
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
      rodada(1, recebe(1, [10, 10, 8]), "2026-03-01"),
      rodada(2, recebe(1, [4, 6, 6]), "2026-03-08"),
      rodada(3, recebe(1, [8, 8, 8]), "2026-03-15"),
    ];
    const naOrdem = replaySkills(rodadas);
    const embaralhado = replaySkills([rodadas[2], rodadas[0], rodadas[1]]);
    expect(embaralhado.history).toEqual(naOrdem.history);
    expect([...embaralhado.skillByPlayer]).toEqual([...naOrdem.skillByPlayer]);
  });

  it("ordena pela data do fut, não pelo id da rodada", () => {
    // Rodada 2 é de um fut ANTERIOR à rodada 1 — tem que ser aplicada antes.
    const cronologico = replaySkills([
      rodada(9, recebe(1, [10, 10, 10]), "2026-03-01"),
      rodada(1, recebe(1, [2, 2, 2]), "2026-03-08"),
    ]);
    expect(cronologico.history.map((h) => h.roundId)).toEqual([9, 1]);
    expect(cronologico.history[0].before).toBe(5);
  });

  // O caso da denúncia aceita: some uma avaliação antiga e tudo depois dela
  // precisa ser recalculado em cadeia.
  it("descartar uma avaliação da rodada 1 muda o resultado da rodada 2", () => {
    // A terceira avaliação é o 0,5★ do troll.
    const r1 = rodada(1, recebe(1, [10, 10, 2]), "2026-03-01");
    const r2 = rodada(2, recebe(1, [8, 8, 8], 2000), "2026-03-08");

    const completo = replaySkills([r1, r2]);
    expect(completo.history.map((h) => h.after)).toEqual([5.8, 6.5]);

    const semOTroll = replaySkills([{ ...r1, ratings: r1.ratings.slice(0, 2) }, r2]);
    expect(semOTroll.history.map((h) => h.after)).toEqual([6.7, 7.1]);
  });

  it("é idempotente: rodar duas vezes dá o mesmo resultado", () => {
    const rodadas = [rodada(1, recebe(1, [10, 8, 6])), rodada(2, recebe(1, [4, 4, 10], 2000))];
    const a = replaySkills(rodadas);
    const b = replaySkills(rodadas);
    expect(b.history).toEqual(a.history);
    expect([...b.skillByPlayer]).toEqual([...a.skillByPlayer]);
  });

  // Sem a destrava, o arredondamento travaria a nota em 9,9 e em 1,1 — os
  // extremos existiriam na escala mas seriam inalcançáveis.
  it("converge para 10,0 com 5★ unânime e estabiliza sem oscilar", () => {
    const rodadas = Array.from({ length: 40 }, (_, i) =>
      rodada(i + 1, recebe(1, [10, 10, 10], 1000 + i * 10)),
    );
    const r = replaySkills(rodadas);
    expect(notaDe(r, 1)).toBe(10);

    // A subida é monótona e passa por 9,9 antes de destravar em 10,0.
    expect(r.history.slice(0, 10).map((h) => h.after)).toEqual([
      6.7, 7.8, 8.5, 9, 9.3, 9.5, 9.7, 9.8, 9.9, 10,
    ]);
    const noTeto = r.history.filter((h) => h.before === 10);
    expect(noTeto.length).toBeGreaterThan(20);
    expect(noTeto.every((h) => h.after === 10)).toBe(true);
  });

  // O piso agora é a MEIA estrela: 0,5★ vale 1,0, o mesmo fundo da escala.
  it("converge para 1,0 com 0,5★ unânime e estabiliza", () => {
    const r = replaySkills(
      Array.from({ length: 40 }, (_, i) => rodada(i + 1, recebe(1, [1, 1, 1], 1000 + i * 10))),
    );
    expect(notaDe(r, 1)).toBe(1);
    const noPiso = r.history.filter((h) => h.before === 1);
    expect(noPiso.length).toBeGreaterThan(20);
    expect(noPiso.every((h) => h.after === 1)).toBe(true);
  });

  // Marcador da régua: 1★ não é mais o fundo do poço (1,0) — vale 2,0. Quem
  // quer dar 1,0 dá meia estrela.
  it("1★ unânime na primeira rodada leva a 4,0, não a 3,7", () => {
    const r = replaySkills([rodada(1, recebe(1, [2, 2, 2]))]);
    expect(r.history[0].averageReceived).toBe(2);
    expect(notaDe(r, 1)).toBe(4);
  });

  // O extremo não gruda: basta uma rodada não-unânime para cair.
  it("um único 4★ derruba a nota de 10,0 para 9,9", () => {
    const subida = Array.from({ length: 12 }, (_, i) =>
      rodada(i + 1, recebe(1, [10, 10, 10, 10, 10], 1000 + i * 10), `2026-03-${String(i + 1).padStart(2, "0")}`),
    );
    const queda = rodada(13, recebe(1, [10, 10, 10, 10, 8], 5000), "2026-03-13");
    const r = replaySkills([...subida, queda]);

    const ultima = r.history.at(-1)!;
    expect(ultima.before).toBe(10);
    expect(ultima.averageReceived).toBe(9.6);
    expect(ultima.after).toBe(9.9);
  });

  // A destrava só age no extremo exato da escala — 4★ unânime (8,0) empaca em
  // 7,9 pela inércia do arredondamento, sem nenhum empurrão.
  it("não destrava quando a média recebida não está no extremo", () => {
    const r = replaySkills(
      Array.from({ length: 40 }, (_, i) => rodada(i + 1, recebe(1, [8, 8, 8], 1000 + i * 10))),
    );
    expect(notaDe(r, 1)).toBe(7.9);
  });

  it("a nota nunca sai da faixa [1,0; 10,0]", () => {
    const rodadas = Array.from({ length: 40 }, (_, i) =>
      rodada(i + 1, recebe(1, i % 2 === 0 ? [10, 10, 10] : [1, 1, 1], 1000 + i * 10)),
    );
    for (const h of replaySkills(rodadas).history) {
      expect(h.after).toBeGreaterThanOrEqual(1);
      expect(h.after).toBeLessThanOrEqual(10);
    }
  });

  it("jogador que só aparece numa rodada tardia começa de 5,0", () => {
    const r = replaySkills([
      rodada(1, recebe(1, [10, 10, 10]), "2026-03-01"),
      rodada(2, recebe(1, [10, 10, 10], 2000), "2026-03-08"),
      rodada(3, [...recebe(1, [10, 10, 10], 3000), ...recebe(2, [10, 10, 10], 4000)], "2026-03-15"),
    ]);
    const primeiraDoDois = r.history.find((h) => h.playerId === 2)!;
    expect(primeiraDoDois.before).toBe(5);
    expect(primeiraDoDois.after).toBe(6.7);
  });

  it("recusa meias-estrelas fora de 1–10", () => {
    expect(() => replaySkills([rodada(1, recebe(1, [0]))])).toThrow(/meias-estrelas inválidas/);
    expect(() => replaySkills([rodada(1, recebe(1, [11]))])).toThrow(/meias-estrelas inválidas/);
    // 3,5 estrelas se escreve 7 — fracionário é dado corrompido.
    expect(() => replaySkills([rodada(1, recebe(1, [3.5]))])).toThrow(/meias-estrelas inválidas/);
  });

  it("recusa auto-avaliação", () => {
    expect(() =>
      replaySkills([rodada(1, [{ raterPlayerId: 7, ratedPlayerId: 7, halfStars: 10 }])]),
    ).toThrow(/a si mesmo/);
  });

  it("recusa o mesmo par duas vezes na mesma rodada", () => {
    expect(() =>
      replaySkills([
        rodada(1, [
          { raterPlayerId: 2, ratedPlayerId: 1, halfStars: 10 },
          { raterPlayerId: 2, ratedPlayerId: 1, halfStars: 2 },
        ]),
      ]),
    ).toThrow(/duplicada/);
  });

  it("aceita o mesmo par em rodadas diferentes", () => {
    const par = (halfStars: number) => [{ raterPlayerId: 2, ratedPlayerId: 1, halfStars }];
    expect(() =>
      replaySkills([rodada(1, par(10), "2026-03-01"), rodada(2, par(2), "2026-03-08")]),
    ).not.toThrow();
  });

  it("a nota nunca sai da grade de uma casa decimal", () => {
    const rodadas = Array.from({ length: 25 }, (_, i) =>
      rodada(i + 1, recebe(1, [1, 3, 8, 10, 5], 1000 + i * 10)),
    );
    const r = replaySkills(rodadas);
    for (const h of r.history) {
      expect(Math.round(h.after * 10) / 10).toBe(h.after);
      expect(Math.round(h.before * 10) / 10).toBe(h.before);
    }
  });

  it("o histórico sai ordenado por rodada e, dentro dela, por playerId", () => {
    const r = replaySkills([
      rodada(2, [...recebe(3, [10], 100), ...recebe(1, [10], 200)], "2026-03-08"),
      rodada(1, [...recebe(2, [10], 300), ...recebe(1, [10], 400)], "2026-03-01"),
    ]);
    expect(r.history.map((h) => [h.roundId, h.playerId])).toEqual([
      [1, 1],
      [1, 2],
      [2, 1],
      [2, 3],
    ]);
  });

  // match_days.date não tem unique, então duas futs no mesmo dia são
  // possíveis. Sem o desempate por id, a nota final dependeria da ordem que o
  // Postgres devolvesse — o mesmo dado daria notas diferentes entre execuções.
  it("desempata futs da mesma data por id, de forma estável", () => {
    const mesmoDia = [
      { ...rodada(7, recebe(1, [2, 2, 2]), "2026-03-01"), matchDayId: 7 },
      { ...rodada(3, recebe(1, [10, 10, 10], 2000), "2026-03-01"), matchDayId: 3 },
    ];
    const naOrdem = replaySkills(mesmoDia);
    const invertido = replaySkills([mesmoDia[1], mesmoDia[0]]);

    // matchDayId 3 antes do 7, independente da ordem de chegada.
    expect(naOrdem.history.map((h) => h.roundId)).toEqual([3, 7]);
    expect(invertido.history).toEqual(naOrdem.history);
  });
});

// A tabela congelada (1★=1,0 · 2★=3,25 · 3★=5,5 · 4★=7,75 · 5★=10,0) das
// rodadas apuradas antes da meia estrela. Estes valores esperados são os
// MESMOS que o motor produzia na época — é este describe que impede a régua
// nova de reescrever nota passada.
describe("replaySkills — régua legada (congelada)", () => {
  it("três 5★ legados continuam levando a 6,7", () => {
    const r = replaySkills([rodadaLegada(1, recebe(1, [10, 10, 10]))]);
    expect(notaDe(r, 1)).toBe(6.7);
    expect(r.history[0].averageReceived).toBe(10);
  });

  // 4★ = 7,75 e 3★ = 5,5 na tabela antiga → média 6,625 → 6,63 (meio-para-cima).
  // Na régua nova os mesmos votos dariam 7,0 — ver "mistura 4★ e 3★" acima.
  it("4★ + 3★ legados valem 6,63, não 7,0", () => {
    const r = replaySkills([rodadaLegada(1, recebe(1, [8, 6]))]);
    expect(r.history[0].averageReceived).toBe(6.63);
    expect(notaDe(r, 1)).toBe(5.5);
  });

  // 2★+3★ antigos = (3,25 + 5,5) / 2 = 4,375 → 4,38.
  it("empate exato de arredondamento não perde centésimo", () => {
    const r = replaySkills([rodadaLegada(1, recebe(1, [4, 6]))]);
    expect(r.history[0].averageReceived).toBe(4.38);
  });

  // 1★+2★ antigos = (1,0 + 3,25) / 2 = 2,125 → 2,13 no meio-para-cima.
  it("arredonda a média meio-para-cima como na época", () => {
    const r = replaySkills([rodadaLegada(1, recebe(1, [2, 4]))]);
    expect(r.history[0].averageReceived).toBe(2.13);
  });

  // O ponto da flag: a MESMA quantidade de estrelas vale diferente conforme a
  // rodada — 3★ legado é 5,5; 3★ novo é 6,0.
  it("mistura rodada legada e nova no mesmo replay, cada uma na sua régua", () => {
    const r = replaySkills([
      rodadaLegada(1, recebe(1, [6]), "2026-03-01"),
      rodada(2, recebe(1, [6], 2000), "2026-03-08"),
    ]);
    expect(r.history.map((h) => h.averageReceived)).toEqual([5.5, 6]);
    expect(r.history.map((h) => h.after)).toEqual([5.2, 5.5]);
  });

  // Rodada legada só tem estrelas inteiras (meias pares, dobradas na
  // migration). Meia estrela ali é dado corrompido — falha alto.
  it("recusa meia estrela em rodada legada", () => {
    expect(() => replaySkills([rodadaLegada(1, recebe(1, [7]))])).toThrow(/legada/);
    expect(() => replaySkills([rodadaLegada(1, recebe(1, [1]))])).toThrow(/legada/);
  });
});

describe("notaParaCent / centParaNota", () => {
  // notaParaCent é o que decide quem recebe UPDATE e "sua nota mudou": é ele
  // que impede 5.699999999999999 e 5.7 contarem como notas diferentes.
  it("faz round-trip em toda a grade de 0,1 da escala", () => {
    for (let cent = SKILL_MIN_CENT; cent <= SKILL_MAX_CENT; cent += 10) {
      const nota = centParaNota(cent);
      expect(notaParaCent(nota)).toBe(cent);
      expect(centParaNota(notaParaCent(nota))).toBe(nota);
    }
  });

  it("absorve o ruído de ponto flutuante", () => {
    expect(notaParaCent(5.699999999999999)).toBe(notaParaCent(5.7));
    expect(notaParaCent(0.1 + 0.2 + 5.4)).toBe(notaParaCent(5.7));
  });
});

describe("diffNotas", () => {
  const inicial = centParaNota(SKILL_INICIAL_CENT);

  it("lista só quem mudou", () => {
    const mudou = diffNotas(
      [
        { id: 1, skill: 5 },
        { id: 2, skill: 6.7 },
      ],
      new Map([
        [1, 6.7],
        [2, 6.7],
      ]),
    );
    expect(mudou).toEqual([{ id: 1, antes: 5, depois: 6.7 }]);
  });

  // O bug que motivou extrair esta função: quem sai do replay tem que voltar
  // para 5,0. Acontece quando o único fut em que ele foi avaliado é apagado
  // por votação, ou quando todas as notas que recebeu são descartadas.
  it("devolve para 5,0 quem sumiu do replay", () => {
    expect(diffNotas([{ id: 1, skill: 6.7 }], new Map())).toEqual([
      { id: 1, antes: 6.7, depois: inicial },
    ]);
  });

  it("replay vazio reseta todo mundo que não estava em 5,0", () => {
    const mudou = diffNotas(
      [
        { id: 1, skill: 6.7 },
        { id: 2, skill: 5 },
        { id: 3, skill: 3.2 },
      ],
      new Map(),
    );
    expect(mudou).toEqual([
      { id: 1, antes: 6.7, depois: inicial },
      { id: 3, antes: 3.2, depois: inicial },
    ]);
  });

  it("não acusa mudança por ruído de ponto flutuante", () => {
    expect(diffNotas([{ id: 1, skill: 5.7 }], new Map([[1, 5.699999999999999]]))).toEqual([]);
  });

  it("é idempotente: aplicado o resultado, não sobra nada para mudar", () => {
    const atuais = [
      { id: 1, skill: 6.7 },
      { id: 2, skill: 4.1 },
    ];
    const alvo = new Map([[1, 5.5]]);
    const depois = atuais.map((p) => ({ id: p.id, skill: alvo.get(p.id) ?? inicial }));
    expect(diffNotas(depois, alvo)).toEqual([]);
  });
});
