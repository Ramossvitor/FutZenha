import { describe, expect, it } from "vitest";
import { pontoDaComemoracao } from "./comemoracao-ponto";

const VIEWPORT = { width: 390, height: 844 };

describe("pontoDaComemoracao", () => {
  it("acha o centro do alvo", () => {
    const caixa = { left: 100, top: 400, width: 120, height: 48 };
    expect(pontoDaComemoracao(caixa, VIEWPORT)).toEqual({ x: 160, y: 424 });
  });

  it("cai no centro da viewport sem alvo", () => {
    expect(pontoDaComemoracao(null, VIEWPORT)).toEqual({ x: 195, y: 422 });
  });

  it("trata rect zerada como ausência de alvo", () => {
    // Botão já desmontado quando a rect foi lida: o browser devolve tudo zero,
    // e o centro do alvo seria o canto superior esquerdo da tela.
    const zerada = { left: 0, top: 0, width: 0, height: 0 };
    expect(pontoDaComemoracao(zerada, VIEWPORT)).toEqual({ x: 195, y: 422 });
  });

  it("prende o alvo colado na borda esquerda com a folga do raio", () => {
    const caixa = { left: -40, top: 400, width: 60, height: 48 };
    expect(pontoDaComemoracao(caixa, VIEWPORT, 22)).toEqual({ x: 22, y: 424 });
  });

  it("prende o alvo abaixo do rodapé", () => {
    // O par Vou/Fora fica no fim do cartão: numa tela curta ele nasce fora.
    const caixa = { left: 100, top: 900, width: 120, height: 48 };
    expect(pontoDaComemoracao(caixa, VIEWPORT, 22)).toEqual({ x: 160, y: 822 });
  });

  it("centraliza quando a viewport é estreita demais para a folga", () => {
    const caixa = { left: 0, top: 0, width: 30, height: 30 };
    expect(pontoDaComemoracao(caixa, { width: 40, height: 40 }, 22)).toEqual({ x: 20, y: 20 });
  });
});
