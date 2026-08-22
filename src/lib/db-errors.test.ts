import { describe, expect, it } from "vitest";
import { isForeignKeyViolation, isUniqueViolation } from "./db-errors";

// O drizzle embrulha o erro do driver (DrizzleQueryError → cause → erro do
// postgres.js), e é na CADEIA que o código mora. Os dois predicados só valem se
// percorrerem a cadeia inteira — e se não confundirem um código com o outro:
// tratar um 23503 como duplicata daria a mensagem errada para o usuário.

function comCodigo(code: string): Error {
  return Object.assign(new Error("driver"), { code });
}

/** O erro do driver enterrado sob `profundidade` embrulhos, como o drizzle faz. */
function embrulhado(code: string, profundidade: number): Error {
  let erro: Error = comCodigo(code);
  for (let i = 0; i < profundidade; i += 1) erro = new Error("embrulho", { cause: erro });
  return erro;
}

describe("isUniqueViolation e isForeignKeyViolation", () => {
  it("acham o código direto no erro", () => {
    expect(isUniqueViolation(comCodigo("23505"))).toBe(true);
    expect(isForeignKeyViolation(comCodigo("23503"))).toBe(true);
  });

  it("acham o código no fundo da cadeia de cause", () => {
    expect(isUniqueViolation(embrulhado("23505", 2))).toBe(true);
    expect(isForeignKeyViolation(embrulhado("23503", 3))).toBe(true);
  });

  it("não confundem um código com o outro", () => {
    expect(isUniqueViolation(embrulhado("23503", 1))).toBe(false);
    expect(isForeignKeyViolation(embrulhado("23505", 1))).toBe(false);
  });

  it("erro sem código, nulo ou que nem é objeto dá false, sem estourar", () => {
    expect(isUniqueViolation(new Error("conexão caiu"))).toBe(false);
    expect(isForeignKeyViolation(new Error("conexão caiu"))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isForeignKeyViolation(undefined)).toBe(false);
    expect(isForeignKeyViolation("23503")).toBe(false);
  });
});
