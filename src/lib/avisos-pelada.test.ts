import { describe, expect, it } from "vitest";
import { avisoDePeladaCriada, avisoDeTimesSorteados, avisoDeVespera } from "./avisos-pelada";

// 2026-08-13 é quinta-feira — data fixa para o weekday não depender do relógio.
const pelada = { id: 7, date: "2026-08-13", location: "Quadra do Zé" };

describe("avisos de pelada", () => {
  it("dedupeKeys estáveis por pelada — é o que torna cada evento idempotente", () => {
    expect(avisoDePeladaCriada(pelada, 3).dedupeKey).toBe("pelada:7:criada");
    expect(avisoDeTimesSorteados(pelada, 3).dedupeKey).toBe("pelada:7:sorteada");
    expect(avisoDeVespera(pelada, 3).dedupeKey).toBe("pelada:7:lembrete-vespera");
  });

  // O dedupeKey NÃO leva o playerId: a unique do banco é (playerId, dedupeKey),
  // então repetir a chave entre jogadores é correto — e mudá-la por jogador
  // quebraria o dedupe de nada.
  it("a mesma chave serve para jogadores diferentes", () => {
    expect(avisoDeVespera(pelada, 3).dedupeKey).toBe(avisoDeVespera(pelada, 8).dedupeKey);
  });

  it("todos apontam para a página da pelada", () => {
    for (const aviso of [
      avisoDePeladaCriada(pelada, 3),
      avisoDeTimesSorteados(pelada, 3),
      avisoDeVespera(pelada, 3),
    ]) {
      expect(aviso.href).toBe("/pelada/7");
      expect(aviso.playerId).toBe(3);
    }
  });

  it("dia e local no corpo — é o que a pessoa precisa para decidir sem abrir", () => {
    const aviso = avisoDePeladaCriada(pelada, 3);
    expect(aviso.body).toContain("13/08");
    expect(aviso.body).toContain("Quadra do Zé");
    expect(avisoDeVespera(pelada, 3).body).toContain("Quadra do Zé");
  });

  it("cada evento tem o próprio type — a caixa de entrada distingue por ele", () => {
    expect(avisoDePeladaCriada(pelada, 3).type).toBe("pelada_criada");
    expect(avisoDeTimesSorteados(pelada, 3).type).toBe("pelada_times_sorteados");
    expect(avisoDeVespera(pelada, 3).type).toBe("pelada_lembrete_vespera");
  });
});
