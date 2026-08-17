import { describe, expect, it } from "vitest";
import { armado, ehPuxadaParaBaixo, LIMIAR, opacidade, resistencia, TETO } from "./puxada";

describe("resistencia", () => {
  it("não sai do lugar sem puxada", () => {
    expect(resistencia(0)).toBe(0);
  });

  it("ignora puxada para cima", () => {
    // Rolagem normal do documento: a pílula não pode aparecer nem um pixel.
    expect(resistencia(-40)).toBe(0);
  });

  it("cresce sem nunca voltar atrás", () => {
    let anterior = -1;
    for (let dy = 0; dy <= 600; dy += 5) {
      const atual = resistencia(dy);
      expect(atual, `dy=${dy}`).toBeGreaterThan(anterior);
      anterior = atual;
    }
  });

  it("resiste: a pílula sempre anda menos que o dedo", () => {
    for (const dy of [1, 10, 50, 93, 200, 600]) {
      expect(resistencia(dy), `dy=${dy}`).toBeLessThan(dy);
    }
  });

  it("satura no teto por mais que se puxe", () => {
    expect(resistencia(10_000)).toBeLessThanOrEqual(TETO);
    expect(resistencia(10_000)).toBeCloseTo(TETO, 3);
  });

  it("arma por volta dos 93px de dedo — a faixa do gesto nativo", () => {
    // Trava o calibre: mexer na curva sem querer mudaria o esforço do gesto de
    // um jeito que nenhum outro teste pegaria.
    expect(armado(resistencia(80))).toBe(false);
    expect(armado(resistencia(95))).toBe(true);
  });
});

describe("armado", () => {
  it("só a partir do limiar", () => {
    expect(armado(LIMIAR - 0.01)).toBe(false);
    expect(armado(LIMIAR)).toBe(true);
    expect(armado(TETO)).toBe(true);
  });
});

describe("ehPuxadaParaBaixo", () => {
  it("aceita o arrasto vertical para baixo", () => {
    expect(ehPuxadaParaBaixo(2, 40)).toBe(true);
  });

  it("recusa o arrasto para cima", () => {
    expect(ehPuxadaParaBaixo(0, -40)).toBe(false);
  });

  it("recusa o deslize lateral", () => {
    // O caso concreto: a faixa de abas `overflow-x-auto` dos rankings. Deslizar
    // entre NOTAS e ARTILHARIA não pode disparar atualização.
    expect(ehPuxadaParaBaixo(60, 10)).toBe(false);
    expect(ehPuxadaParaBaixo(-60, 10)).toBe(false);
  });

  it("recusa o diagonal exato, que é ambíguo demais para roubar", () => {
    expect(ehPuxadaParaBaixo(30, 30)).toBe(false);
  });
});

describe("opacidade", () => {
  it("nasce invisível e chega opaca no ponto em que arma", () => {
    expect(opacidade(0)).toBe(0);
    expect(opacidade(LIMIAR / 2)).toBeCloseTo(0.5, 5);
    expect(opacidade(LIMIAR)).toBe(1);
  });

  it("não passa de 1 depois do limiar", () => {
    expect(opacidade(TETO)).toBe(1);
  });
});
