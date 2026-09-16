import { describe, expect, it } from "vitest";
import { REGEX_DE_COR } from "./cor";
import {
  chaveDoNomeDeTime,
  COLETES_PADRAO,
  completarColetes,
  CORES_DE_COLETE,
  ESCOLHA_OUTRA_COR,
  ESCOLHA_SEM_COLETE,
  escolhaInicialDoColete,
  SWATCHES_DE_COLETE,
} from "./team-colors";

describe("a paleta", () => {
  it("guarda as cores no formato do banco — minúsculas, #rrggbb", () => {
    for (const cor of Object.values(CORES_DE_COLETE)) expect(cor).toMatch(REGEX_DE_COR);
  });

  it("os padrões são os seis nomes de sempre, na ordem, com a cor da amostra", () => {
    expect(COLETES_PADRAO.map((c) => c.nome)).toEqual([
      "Preto",
      "Branco",
      "Verde",
      "Laranja",
      "Azul",
      "Vermelho",
    ]);
    for (const padrao of COLETES_PADRAO) {
      expect(SWATCHES_DE_COLETE.find((s) => s.nome === padrao.nome)?.cor).toBe(padrao.cor);
    }
  });

  it("o seletor oferece as sete cores, sem repetir", () => {
    expect(SWATCHES_DE_COLETE).toHaveLength(7);
    expect(new Set(SWATCHES_DE_COLETE.map((s) => s.cor)).size).toBe(7);
  });
});

describe("chaveDoNomeDeTime", () => {
  it("ignora caixa e espaço nas pontas — e só isso", () => {
    expect(chaveDoNomeDeTime("  PRETO ")).toBe("preto");
    expect(chaveDoNomeDeTime("Com Colete")).toBe("com colete");
    expect(chaveDoNomeDeTime("Com  Colete")).not.toBe("com colete");
  });
});

describe("completarColetes", () => {
  it("sem presets, o sorteio de 2 sai Preto × Branco — como sempre saiu", () => {
    expect(completarColetes([], 2)).toEqual([
      { nome: "Preto", cor: CORES_DE_COLETE.preto },
      { nome: "Branco", cor: CORES_DE_COLETE.branco },
    ]);
  });

  it("os presets vêm primeiro, na ordem, e só entram os que cabem", () => {
    const presets = [
      { nome: "Com Colete", cor: "#f2740f" },
      { nome: "Sem Colete", cor: null },
      { nome: "Terceiro", cor: null },
    ];
    expect(completarColetes(presets, 2)).toEqual(presets.slice(0, 2));
  });

  it("completa com os padrões, pulando os nomes que o grupo já usou (sem olhar caixa)", () => {
    const coletes = completarColetes([{ nome: " branco ", cor: null }], 3);
    expect(coletes.map((c) => c.nome)).toEqual([" branco ", "Preto", "Verde"]);
    expect(coletes[1].cor).toBe(CORES_DE_COLETE.preto);
  });

  it("depois dos padrões vem 'Time N', sem cor, sem colidir com nome existente", () => {
    const seis = COLETES_PADRAO.map((c) => ({ nome: c.nome, cor: c.cor }));
    const coletes = completarColetes([...seis, { nome: "Time 8", cor: "#123456" }], 9);
    expect(coletes.map((c) => c.nome)).toEqual([
      ...seis.map((c) => c.nome),
      "Time 8",
      "Time 9",
      "Time 10",
    ]);
    expect(coletes[7]).toEqual({ nome: "Time 9", cor: null });
  });

  it("devolve exatamente a quantidade pedida, com nomes únicos", () => {
    for (const quantidade of [0, 1, 2, 6, 8]) {
      const coletes = completarColetes([{ nome: "verde", cor: null }], quantidade);
      expect(coletes).toHaveLength(quantidade);
      expect(new Set(coletes.map((c) => chaveDoNomeDeTime(c.nome))).size).toBe(quantidade);
    }
  });

  it("devolve cópias — mexer no resultado não mexe nos presets", () => {
    const presets = [{ nome: "A", cor: null }];
    const coletes = completarColetes(presets, 2);
    coletes[0].nome = "B";
    expect(presets[0].nome).toBe("A");
  });
});

describe("escolhaInicialDoColete", () => {
  it("cor nula é 'sem colete'; amostra gravada é ela mesma; tom livre é 'outra'", () => {
    expect(escolhaInicialDoColete(null, CORES_DE_COLETE.preto)).toBe(ESCOLHA_SEM_COLETE);
    expect(escolhaInicialDoColete(CORES_DE_COLETE.azul, null)).toBe(CORES_DE_COLETE.azul);
    expect(escolhaInicialDoColete("#123456", null)).toBe(ESCOLHA_OUTRA_COR);
  });

  it("sem nada gravado vale o padrão da posição — e sem padrão, 'sem colete'", () => {
    expect(escolhaInicialDoColete(undefined, CORES_DE_COLETE.verde)).toBe(CORES_DE_COLETE.verde);
    expect(escolhaInicialDoColete(undefined, null)).toBe(ESCOLHA_SEM_COLETE);
  });
});
