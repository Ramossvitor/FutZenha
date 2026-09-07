import { describe, expect, it } from "vitest";
import {
  escolherFutParaOperar,
  fraseDoPlacar,
  lerInteiro,
  lerLado,
  resolverAutor,
  rotulosUnicos,
} from "./sumula-relogio";

const fut = (
  id: number,
  extra: Partial<{ temJogoAberto: boolean; distanciaEmDias: number; vinculoDireto: boolean }> = {},
) => ({ id, temJogoAberto: false, distanciaEmDias: 0, vinculoDireto: true, ...extra });

describe("escolherFutParaOperar", () => {
  it("sem candidato, nenhum", () => {
    expect(escolherFutParaOperar([])).toEqual({ tipo: "nenhum" });
  });

  it("um candidato só é ele", () => {
    expect(escolherFutParaOperar([fut(7)])).toEqual({ tipo: "um", fut: fut(7) });
  });

  // A bola está rolando em algum lugar: é lá que o operador está.
  it("jogo aberto ganha de data mais próxima", () => {
    const hoje = fut(1, { distanciaEmDias: 0 });
    const aberto = fut(2, { distanciaEmDias: 3, temJogoAberto: true });
    expect(escolherFutParaOperar([hoje, aberto])).toEqual({ tipo: "um", fut: aberto });
  });

  it("dois jogos abertos é ambíguo", () => {
    const a = fut(1, { temJogoAberto: true });
    const b = fut(2, { temJogoAberto: true });
    expect(escolherFutParaOperar([a, b])).toEqual({ tipo: "varios", candidatos: [a, b] });
  });

  it("sem jogo aberto, o de data mais próxima", () => {
    const longe = fut(1, { distanciaEmDias: 5 });
    const perto = fut(2, { distanciaEmDias: 1 });
    expect(escolherFutParaOperar([longe, perto])).toEqual({ tipo: "um", fut: perto });
  });

  it("empate de data é ambíguo, e só os empatados entram na lista", () => {
    const a = fut(1, { distanciaEmDias: 1 });
    const b = fut(2, { distanciaEmDias: 1 });
    const c = fut(3, { distanciaEmDias: 4 });
    expect(escolherFutParaOperar([a, b, c])).toEqual({ tipo: "varios", candidatos: [a, b] });
  });

  // O admin da plataforma opera qualquer fut, mas não está em qualquer fut:
  // o que ele alcança só por ser admin não pode disputar com o fut dele.
  it("vínculo direto vence o alcance de admin da plataforma", () => {
    const alheio = fut(1, { temJogoAberto: true, vinculoDireto: false });
    const meu = fut(2, { distanciaEmDias: 2 });
    expect(escolherFutParaOperar([alheio, meu])).toEqual({ tipo: "um", fut: meu });
  });

  it("sem vínculo direto nenhum, o alcance de admin ainda serve", () => {
    const alheio = fut(1, { vinculoDireto: false });
    expect(escolherFutParaOperar([alheio])).toEqual({ tipo: "um", fut: alheio });
  });
});

describe("rotulosUnicos", () => {
  it("mapeia rótulo para id", () => {
    expect(
      rotulosUnicos([
        { playerId: 3, rotulo: "Zé" },
        { playerId: 8, rotulo: "Rafa" },
      ]),
    ).toEqual({ Zé: 3, Rafa: 8 });
  });

  // Dois "Zé" no mesmo lado num objeto viram um só — e um jogador sumiria da
  // lista do relógio.
  it("desempata homônimos com sufixo numérico", () => {
    expect(
      rotulosUnicos([
        { playerId: 1, rotulo: "Zé" },
        { playerId: 2, rotulo: "Zé" },
        { playerId: 3, rotulo: "Zé" },
      ]),
    ).toEqual({ Zé: 1, "Zé (2)": 2, "Zé (3)": 3 });
  });

  it("não tropeça em apelido que é nome de propriedade", () => {
    expect(rotulosUnicos([{ playerId: 5, rotulo: "constructor" }])).toEqual({ constructor: 5 });
  });
});

describe("lerInteiro", () => {
  it("aceita número inteiro e string de dígitos", () => {
    expect(lerInteiro(12)).toEqual({ ok: true, valor: 12 });
    expect(lerInteiro("12")).toEqual({ ok: true, valor: 12 });
    expect(lerInteiro(" 7 ")).toEqual({ ok: true, valor: 7 });
    expect(lerInteiro(0)).toEqual({ ok: true, valor: 0 });
    expect(lerInteiro(2_147_483_647)).toEqual({ ok: true, valor: 2_147_483_647 });
  });

  it("ausente é 'não informado', não erro", () => {
    expect(lerInteiro(undefined)).toEqual({ ok: true, valor: null });
    expect(lerInteiro(null)).toEqual({ ok: true, valor: null });
    expect(lerInteiro("")).toEqual({ ok: true, valor: null });
  });

  it("recusa o que não é inteiro", () => {
    expect(lerInteiro(1.5)).toEqual({ ok: false });
    expect(lerInteiro("x")).toEqual({ ok: false });
    expect(lerInteiro("1e3")).toEqual({ ok: false });
    expect(lerInteiro({})).toEqual({ ok: false });
    expect(lerInteiro(true)).toEqual({ ok: false });
  });

  // O que passaria daqui e estouraria o `integer` do Postgres — um 500 no
  // lugar do 400 que o atalho sabe ler.
  it("recusa o que não cabe num id", () => {
    expect(lerInteiro(-1)).toEqual({ ok: false });
    expect(lerInteiro(2 ** 31)).toEqual({ ok: false });
    expect(lerInteiro("99999999999999999999")).toEqual({ ok: false });
  });
});

describe("lerLado", () => {
  it("A ou B, em qualquer caixa e com espaço", () => {
    expect(lerLado("A")).toBe("A");
    expect(lerLado(" b ")).toBe("B");
  });

  it("qualquer outra coisa é null", () => {
    expect(lerLado("C")).toBeNull();
    expect(lerLado("")).toBeNull();
    expect(lerLado(1)).toBeNull();
    expect(lerLado(undefined)).toBeNull();
  });
});

describe("fraseDoPlacar", () => {
  it("time A, placar, time B", () => {
    expect(fraseDoPlacar({ timeA: "Preto", timeB: "Branco", scoreA: 2, scoreB: 1 })).toBe(
      "Preto 2 × 1 Branco",
    );
  });
});

describe("resolverAutor", () => {
  const escalacao = [
    { playerId: 1, nome: "José da Silva", apelido: "Zé" },
    { playerId: 2, nome: "Rafael Costa", apelido: null },
    { playerId: 3, nome: "Rafaela Lima", apelido: "Rafa" },
    { playerId: 4, nome: "Diego Ferreira", apelido: null },
  ];

  it("acha por apelido e por nome, ignorando acento e caixa", () => {
    expect(resolverAutor("ze", escalacao)).toEqual({ ok: true, playerId: 1 });
    expect(resolverAutor("JOSÉ DA SILVA", escalacao)).toEqual({ ok: true, playerId: 1 });
    expect(resolverAutor("rafa", escalacao)).toEqual({ ok: true, playerId: 3 });
  });

  it("começo único do nome serve", () => {
    expect(resolverAutor("Diego", escalacao)).toEqual({ ok: true, playerId: 4 });
    expect(resolverAutor("Rafaela", escalacao)).toEqual({ ok: true, playerId: 3 });
  });

  it("começo de qualquer palavra do nome serve, se for único", () => {
    expect(resolverAutor("Costa", escalacao)).toEqual({ ok: true, playerId: 2 });
    expect(resolverAutor("Ferreira", escalacao)).toEqual({ ok: true, playerId: 4 });
  });

  // O apelido exato de um vence o começo do nome do outro: "Rafa" é a Rafaela.
  it("o nível exato decide antes do prefixo", () => {
    expect(resolverAutor("Rafa", escalacao)).toEqual({ ok: true, playerId: 3 });
  });

  // Dois candidatos no mesmo nível: ninguém leva o gol.
  it("prefixo ambíguo é falha, não o primeiro da lista", () => {
    expect(resolverAutor("Raf", escalacao)).toEqual({ ok: false });
  });

  it("nome que não está na escalação, ou texto vazio, é falha", () => {
    expect(resolverAutor("Igor", escalacao)).toEqual({ ok: false });
    expect(resolverAutor("   ", escalacao)).toEqual({ ok: false });
    expect(resolverAutor("Zé", [])).toEqual({ ok: false });
  });
});
