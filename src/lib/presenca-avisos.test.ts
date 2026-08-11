// As duas peças puras de src/lib/presenca.ts. O módulo é server-only e importa
// @/db, mas roda aqui graças ao stub de server-only e à DATABASE_URL inerte do
// projeto unit (ver vitest.config.mts) — nenhum teste abaixo toca o banco.
import { describe, expect, it } from "vitest";
import { avisoDePromocao, mereceAviso } from "@/lib/presenca";
import type { Session } from "@/lib/session";

// mereceAviso só lê player.id — o resto da sessão não participa da regra.
const sessaoDe = (playerId: number) => ({ player: { id: playerId } }) as Session;

const incluidoDeFora = { temContaAtiva: true, jaEstaNoFut: false, elegivel: true };

describe("mereceAviso", () => {
  // Exatamente o caso que a exceção da lista fechada abriu: alguém com conta
  // sendo posto no fut por outra pessoa.
  it("avisa quem tem conta, estava fora e foi posto por outro", () => {
    expect(mereceAviso(sessaoDe(1), 2, incluidoDeFora)).toBe(true);
  });

  it("não avisa o próprio ator do que ele mesmo fez", () => {
    expect(mereceAviso(sessaoDe(2), 2, incluidoDeFora)).toBe(false);
  });

  it("não avisa quem não tem conta ativa — não há onde receber", () => {
    expect(mereceAviso(sessaoDe(1), 2, { ...incluidoDeFora, temContaAtiva: false })).toBe(false);
  });

  it("não avisa quem já estava no fut — não é novidade", () => {
    expect(mereceAviso(sessaoDe(1), 2, { ...incluidoDeFora, jaEstaNoFut: true })).toBe(false);
  });
});

describe("avisoDePromocao", () => {
  const fut = { id: 12, date: "2026-08-12", location: "Quadra do Zé" };

  // O formato é contrato, não detalhe: a dedupeKey é o que impede a mesma
  // promoção de notificar duas vezes, e mudá-la quebraria a deduplicação contra
  // o que já está gravado no banco.
  it("dedupeKey, type e href seguem o formato pinado", () => {
    const aviso = avisoDePromocao(fut, 7);
    expect(aviso.dedupeKey).toBe("espera-promovido:12:7");
    expect(aviso.type).toBe("pelada_presenca_definida");
    expect(aviso.href).toBe("/fut/12");
    expect(aviso.playerId).toBe(7);
  });

  it("o corpo diz onde é o fut", () => {
    expect(avisoDePromocao(fut, 7).body).toContain("Quadra do Zé");
  });
});
