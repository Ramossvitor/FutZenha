// O vocabulário visual da recarga. O formatarReais é a única formatação de
// dinheiro do sistema — se ela errar centavo, erra nas três telas de uma vez.

import { describe, expect, it } from "vitest";
import { recargaStatusEnum } from "@/db/schema";
import { formatarReais, rotuloDoStatus } from "./recarga-formato";

// O toLocaleString usa espaço inflexível entre o símbolo e o número; o teste
// normaliza para não depender da versão do ICU.
function plano(valor: string): string {
  return valor.replace(/ /g, " ");
}

describe("formatarReais", () => {
  it("formata centavos como moeda brasileira", () => {
    expect(plano(formatarReais(1000))).toBe("R$ 10,00");
    expect(plano(formatarReais(1050))).toBe("R$ 10,50");
    expect(plano(formatarReais(1))).toBe("R$ 0,01");
    expect(plano(formatarReais(123456))).toBe("R$ 1.234,56");
  });
});

describe("rotuloDoStatus", () => {
  // Derivado do enum do schema: status novo no banco sem rótulo aqui não
  // compila — mas se compilar por um `as`, este teste segura.
  it("cobre todos os status do enum", () => {
    for (const status of recargaStatusEnum.enumValues) {
      const selo = rotuloDoStatus(status);
      expect(selo.texto.length).toBeGreaterThan(0);
    }
  });

  it("só o pendente pulsa com ponto", () => {
    expect(rotuloDoStatus("pendente").ponto).toBe(true);
    expect(rotuloDoStatus("pago").ponto).toBe(false);
  });
});
