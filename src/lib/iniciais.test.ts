import { describe, expect, it } from "vitest";
import { iniciais } from "./iniciais";

describe("iniciais", () => {
  it("usa primeira e última palavra", () => {
    expect(iniciais("Marcos Vinícius")).toBe("MV");
    expect(iniciais("Arthur Nogueira")).toBe("AN");
  });

  it("com uma palavra só, usa as duas primeiras letras", () => {
    expect(iniciais("Tuca")).toBe("TU");
    expect(iniciais("Zóio")).toBe("ZÓ");
  });

  it("pula partículas — 'JD' não identificaria ninguém", () => {
    expect(iniciais("João da Silva")).toBe("JS");
    expect(iniciais("Maria dos Santos")).toBe("MS");
    expect(iniciais("Tião de Souza e Lima")).toBe("TL");
  });

  it("aguenta espaço sobrando e nome de uma letra", () => {
    expect(iniciais("  Rafa   Moura  ")).toBe("RM");
    expect(iniciais("J")).toBe("J");
  });

  it("não quebra com nome vazio", () => {
    expect(iniciais("")).toBe("?");
    expect(iniciais("   ")).toBe("?");
  });

  it("conta acento como uma letra só", () => {
    // "Ó" é um code point único aqui; o spread evita cortar par substituto ao meio
    expect(iniciais("Ótimo")).toBe("ÓT");
  });
});
