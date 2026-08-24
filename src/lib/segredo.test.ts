// A comparação em tempo constante que protege o cron e o webhook de pagamento.
// O comportamento funcional é trivial; o teste existe para ninguém "simplificar"
// para um `===` sem um arquivo gritando.

import { describe, expect, it } from "vitest";
import { segredoConfere } from "./segredo";

describe("segredoConfere", () => {
  it("aceita segredos idênticos", () => {
    expect(segredoConfere("abc123", "abc123")).toBe(true);
    expect(segredoConfere("", "")).toBe(true);
  });

  it("recusa diferença em qualquer posição", () => {
    expect(segredoConfere("abc123", "abc124")).toBe(false);
    expect(segredoConfere("xbc123", "abc123")).toBe(false);
  });

  // O curto-circuito por tamanho não vaza conteúdo — só o comprimento, que o
  // atacante já conhece do formato.
  it("recusa tamanhos diferentes", () => {
    expect(segredoConfere("abc", "abc1")).toBe(false);
    expect(segredoConfere("abc1", "abc")).toBe(false);
    expect(segredoConfere("", "a")).toBe(false);
  });
});
