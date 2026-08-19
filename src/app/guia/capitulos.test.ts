// O sumário do guia é o que o índice percorre e o que as âncoras usam. Id
// repetido faria dois capítulos brigarem pela mesma âncora; id fora de
// kebab-case quebraria o link que alguém já mandou no WhatsApp.
import { describe, expect, it } from "vitest";
import { CAMADAS, CAPITULOS, capitulosDaCamada } from "./capitulos";

describe("capítulos do guia", () => {
  it("não repete id", () => {
    const ids = CAPITULOS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("usa id em kebab-case", () => {
    for (const c of CAPITULOS) {
      expect(c.id, `id inválido: ${c.id}`).toMatch(/^[a-z]+(-[a-z]+)*$/);
    }
  });

  it("dá título e resumo a todo capítulo", () => {
    for (const c of CAPITULOS) {
      expect(c.titulo.length, `sem título: ${c.id}`).toBeGreaterThan(0);
      expect(c.resumo.length, `sem resumo: ${c.id}`).toBeGreaterThan(0);
    }
  });

  it("não deixa camada vazia", () => {
    for (const camada of CAMADAS) {
      expect(capitulosDaCamada(camada.id).length, `camada vazia: ${camada.id}`).toBeGreaterThan(0);
    }
  });
});
