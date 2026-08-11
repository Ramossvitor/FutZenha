import { describe, expect, it } from "vitest";
import { avisoDeFutCriado, avisoDeTimesSorteados, avisoDeVespera } from "./avisos-fut";

// 2026-08-13 é quinta-feira — data fixa para o weekday não depender do relógio.
const fut = { id: 7, date: "2026-08-13", location: "Quadra do Zé" };

describe("avisos de fut", () => {
  it("dedupeKeys estáveis por fut — é o que torna cada evento idempotente", () => {
    expect(avisoDeFutCriado(fut, 3).dedupeKey).toBe("pelada:7:criada");
    expect(avisoDeTimesSorteados(fut, 3).dedupeKey).toBe("pelada:7:sorteada");
    expect(avisoDeVespera(fut, 3).dedupeKey).toBe("pelada:7:lembrete-vespera");
  });

  // O dedupeKey NÃO leva o playerId: a unique do banco é (playerId, dedupeKey),
  // então repetir a chave entre jogadores é correto — e mudá-la por jogador
  // quebraria o dedupe de nada.
  it("a mesma chave serve para jogadores diferentes", () => {
    expect(avisoDeVespera(fut, 3).dedupeKey).toBe(avisoDeVespera(fut, 8).dedupeKey);
  });

  it("todos apontam para a página do fut", () => {
    for (const aviso of [
      avisoDeFutCriado(fut, 3),
      avisoDeTimesSorteados(fut, 3),
      avisoDeVespera(fut, 3),
    ]) {
      expect(aviso.href).toBe("/fut/7");
      expect(aviso.playerId).toBe(3);
    }
  });

  it("dia e local no corpo — é o que a pessoa precisa para decidir sem abrir", () => {
    const aviso = avisoDeFutCriado(fut, 3);
    expect(aviso.body).toContain("13/08");
    expect(aviso.body).toContain("Quadra do Zé");
    expect(avisoDeVespera(fut, 3).body).toContain("Quadra do Zé");
  });

  it("cada evento tem o próprio type — a caixa de entrada distingue por ele", () => {
    expect(avisoDeFutCriado(fut, 3).type).toBe("pelada_criada");
    expect(avisoDeTimesSorteados(fut, 3).type).toBe("pelada_times_sorteados");
    expect(avisoDeVespera(fut, 3).type).toBe("pelada_lembrete_vespera");
  });
});
