import { describe, expect, it } from "vitest";
import { textoDePrazo, tomDePrazo } from "./prazo";

describe("tomDePrazo", () => {
  it("fica calmo acima de 24h", () => {
    expect(tomDePrazo(48)).toBe("calmo");
    expect(tomDePrazo(24)).toBe("calmo");
  });

  it("aperta abaixo de 24h", () => {
    expect(tomDePrazo(23)).toBe("apertado");
    expect(tomDePrazo(6)).toBe("apertado");
  });

  it("fica urgente abaixo de 6h", () => {
    expect(tomDePrazo(5)).toBe("urgente");
    expect(tomDePrazo(1)).toBe("urgente");
  });

  it("zero é vencido, não urgente", () => {
    // o Postgres devolve greatest(0, ...), então prazo estourado chega como 0
    expect(tomDePrazo(0)).toBe("vencido");
    expect(tomDePrazo(-3)).toBe("vencido");
  });
});

describe("textoDePrazo", () => {
  it("usa hora abaixo de um dia", () => {
    expect(textoDePrazo(5)).toBe("faltam 5h");
    expect(textoDePrazo(23)).toBe("faltam 23h");
  });

  it("concorda o verbo no singular", () => {
    expect(textoDePrazo(1)).toBe("falta 1h");
    expect(textoDePrazo(24)).toBe("falta 1 dia");
  });

  it("vira dia quando passa de 24h, para ninguém fazer conta", () => {
    expect(textoDePrazo(28)).toBe("faltam 1 dia e 4h");
    expect(textoDePrazo(48)).toBe("faltam 2 dias");
    expect(textoDePrazo(50)).toBe("faltam 2 dias e 2h");
  });

  it("não promete prazo que já acabou", () => {
    expect(textoDePrazo(0)).toBe("prazo encerrado");
  });
});
