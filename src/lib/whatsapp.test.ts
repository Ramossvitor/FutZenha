import { describe, expect, it } from "vitest";
import { linkWaMe, textoDeConvocacao, textoDeTimes } from "./whatsapp";

// 2026-08-13 é uma quinta-feira — data fixa para o weekday não depender do dia
// em que o teste roda.
const pelada = {
  id: 12,
  date: "2026-08-13",
  startTime: "20:00:00" as string | null,
  location: "Quadra do Zé",
  notes: null as string | null,
};

describe("textoDeConvocacao", () => {
  it("leva dia, hora, local e o link da pelada", () => {
    const texto = textoDeConvocacao(pelada, "https://futzenha.app");
    expect(texto).toContain("quinta-feira");
    expect(texto).toContain("13/08");
    expect(texto).toContain("às 20:00");
    expect(texto).toContain("Quadra do Zé");
    expect(texto).toContain("https://futzenha.app/pelada/12");
  });

  it("sem horário, não inventa um 'às'", () => {
    const texto = textoDeConvocacao({ ...pelada, startTime: null }, "https://futzenha.app");
    expect(texto).not.toContain("às");
  });

  // As observações são onde mora o "trazer colete azul" — quando existem,
  // precisam ir junto; quando não, nada de linha vazia sobrando.
  it("observações entram quando existem", () => {
    const com = textoDeConvocacao({ ...pelada, notes: "Trazer colete azul" }, "https://x.app");
    const sem = textoDeConvocacao(pelada, "https://x.app");
    expect(com).toContain("Trazer colete azul");
    expect(sem.split("\n")).toHaveLength(4);
    expect(com.split("\n")).toHaveLength(5);
  });
});

describe("textoDeTimes", () => {
  it("um bloco por time, jogadores em lista", () => {
    const texto = textoDeTimes(pelada, [
      { nome: "Verde", jogadores: ["Zé", "Tonho"] },
      { nome: "Vermelho", jogadores: ["Juca"] },
    ]);
    expect(texto).toContain("Times da pelada de quinta-feira");
    expect(texto).toContain("Verde:\n- Zé\n- Tonho");
    expect(texto).toContain("Vermelho:\n- Juca");
    // Linha em branco entre os times — sem ela o texto vira um parede no zap.
    expect(texto).toContain("Tonho\n\nVermelho");
  });
});

describe("linkWaMe", () => {
  it("encoda emoji e quebras de linha para a URL sobreviver", () => {
    const link = linkWaMe("⚽ Pelada\nQuadra & cia");
    expect(link.startsWith("https://wa.me/?text=")).toBe(true);
    expect(link).toContain("%E2%9A%BD");
    expect(link).toContain("%0A");
    expect(link).toContain("%26");
    expect(link).not.toContain("\n");
  });
});
