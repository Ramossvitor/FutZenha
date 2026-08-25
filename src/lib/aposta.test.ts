import { describe, expect, it } from "vitest";
import {
  type ApostaEmDisputa,
  dividirPote,
  type JogoApurado,
  timeDoApostador,
  vencedorDoFut,
} from "./aposta";

const jogo = (teamAId: number, scoreA: number, teamBId: number, scoreB: number): JogoApurado => ({
  teamAId,
  teamBId,
  scoreA,
  scoreB,
});

const aposta = (apostaId: number, valor: number, vencedora: boolean): ApostaEmDisputa => ({
  apostaId,
  valor,
  vencedora,
});

describe("vencedorDoFut", () => {
  it("quem venceu mais jogos leva o fut", () => {
    expect(vencedorDoFut([jogo(1, 3, 2, 1), jogo(1, 2, 2, 0), jogo(1, 0, 2, 1)])).toBe(1);
  });

  it("conta por TIME, não por lado — o fut de rodízio tem mais de dois", () => {
    // O 3 vence os dois jogos que disputa; o 1 e o 2 vencem um cada.
    expect(
      vencedorDoFut([jogo(1, 2, 2, 0), jogo(3, 1, 1, 0), jogo(2, 1, 3, 2)]),
    ).toBe(3);
  });

  it("o time que só empatou continua na conta, e pode vencer no saldo", () => {
    // Ninguém vence jogo nenhum: 1 e 2 empatam 0x0, 1 e 3 empatam 3x3. Todos com
    // zero vitórias, e o saldo de todos é zero — sem vencedor.
    expect(vencedorDoFut([jogo(1, 0, 2, 0), jogo(1, 3, 3, 3)])).toBeNull();
  });

  it("empate de vitórias é decidido pelo saldo de gols do dia", () => {
    // Uma vitória para cada, mas o time 2 venceu por mais.
    expect(vencedorDoFut([jogo(1, 1, 2, 0), jogo(2, 4, 1, 0)])).toBe(2);
  });

  it("empate também no saldo não tem vencedor — todas as apostas voltam", () => {
    expect(vencedorDoFut([jogo(1, 2, 2, 0), jogo(2, 2, 1, 0)])).toBeNull();
  });

  it("fut sem jogo lançado não tem vencedor", () => {
    expect(vencedorDoFut([])).toBeNull();
  });

  it("um jogo só decide o fut", () => {
    expect(vencedorDoFut([jogo(7, 1, 9, 0)])).toBe(7);
    expect(vencedorDoFut([jogo(7, 1, 9, 1)])).toBeNull();
  });
});

describe("timeDoApostador", () => {
  it("jogou sempre pelo mesmo time", () => {
    expect(timeDoApostador([4, 4, 4], false)).toEqual({ teamId: 4 });
    expect(timeDoApostador([4], false)).toEqual({ teamId: 4 });
  });

  it("não entrou em campo", () => {
    expect(timeDoApostador([], false)).toBe("nao-jogou");
    // Nem o log de troca salva quem não jogou: sem jogo não há por que disputar.
    expect(timeDoApostador([], true)).toBe("nao-jogou");
  });

  it("times diferentes entre os jogos é troca", () => {
    expect(timeDoApostador([4, 5], false)).toBe("trocou-de-time");
    expect(timeDoApostador([4, 4, 5], false)).toBe("trocou-de-time");
  });

  it("o log de troca de lado basta, mesmo com o snapshot uniforme", () => {
    // A troca com o jogo em andamento reescreve o game_players daquele jogo, e
    // sem o log ela passaria por "sempre jogou pelo 4".
    expect(timeDoApostador([4], true)).toBe("trocou-de-time");
  });
});

describe("dividirPote", () => {
  it("o perdedor paga o vencedor, proporcional ao que cada um apostou", () => {
    // Perdido = 90. O 1 tem 2/3 do lado vencedor e leva 60; o 2 leva 30.
    expect(
      dividirPote([aposta(1, 100, true), aposta(2, 50, true), aposta(3, 90, false)]),
    ).toEqual([
      { apostaId: 1, retorno: 160, desfecho: "paga" },
      { apostaId: 2, retorno: 80, desfecho: "paga" },
      { apostaId: 3, retorno: 0, desfecho: "perdida" },
    ]);
  });

  it("vencedor sozinho leva o pote inteiro dos perdedores", () => {
    expect(dividirPote([aposta(1, 10, true), aposta(2, 30, false), aposta(3, 20, false)])).toEqual([
      { apostaId: 1, retorno: 60, desfecho: "paga" },
      { apostaId: 2, retorno: 0, desfecho: "perdida" },
      { apostaId: 3, retorno: 0, desfecho: "perdida" },
    ]);
  });

  it("só vencedores (ou só perdedores) devolve tudo — não houve aposta contra ninguém", () => {
    expect(dividirPote([aposta(1, 10, true), aposta(2, 20, true)])).toEqual([
      { apostaId: 1, retorno: 10, desfecho: "devolvida" },
      { apostaId: 2, retorno: 20, desfecho: "devolvida" },
    ]);
    expect(dividirPote([aposta(1, 10, false), aposta(2, 20, false)])).toEqual([
      { apostaId: 1, retorno: 10, desfecho: "devolvida" },
      { apostaId: 2, retorno: 20, desfecho: "devolvida" },
    ]);
  });

  it("lista vazia não devolve nada", () => {
    expect(dividirPote([])).toEqual([]);
  });

  it("a sobra do arredondamento some — nenhuma zenha nasce na divisão", () => {
    // Perdido = 7, ganho = 3 (duas apostas de 1 e uma de 1... números primos de
    // propósito): cada vencedor levaria 7/3, e o floor corta.
    const desfechos = dividirPote([
      aposta(1, 1, true),
      aposta(2, 1, true),
      aposta(3, 1, true),
      aposta(4, 7, false),
    ]);
    const pago = desfechos.reduce((soma, d) => soma + d.retorno, 0);
    expect(pago).toBe(9); // 3 apostas de volta + 2 para cada = 9, sobra 1 do pote de 7
    expect(pago).toBeLessThan(1 + 1 + 1 + 7);
  });

  it("Σ retornos nunca passa de Σ apostado, em qualquer combinação", () => {
    const valores = [1, 3, 7, 11, 13, 17, 23, 97];
    for (let mascara = 0; mascara < 1 << valores.length; mascara++) {
      const apostas = valores.map((valor, i) =>
        aposta(i + 1, valor, (mascara & (1 << i)) !== 0),
      );
      const apostado = apostas.reduce((soma, a) => soma + a.valor, 0);
      const pago = dividirPote(apostas).reduce((soma, d) => soma + d.retorno, 0);
      expect(pago).toBeLessThanOrEqual(apostado);
    }
  });

  it("quem venceu nunca recebe menos do que apostou", () => {
    const desfechos = dividirPote([aposta(1, 500, true), aposta(2, 1, false)]);
    expect(desfechos[0].retorno).toBeGreaterThanOrEqual(500);
  });
});
