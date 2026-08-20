// As duas peças puras de src/lib/presenca.ts. O módulo é server-only e importa
// @/db, mas roda aqui graças ao stub de server-only e à DATABASE_URL inerte do
// projeto unit (ver vitest.config.mts) — nenhum teste abaixo toca o banco.
import { describe, expect, it } from "vitest";
import { avisoDePromocao, mereceAviso } from "@/lib/presenca";
import type { Session } from "@/lib/session";

// mereceAviso só lê player.id — o resto da sessão não participa da regra.
const sessaoDe = (playerId: number) => ({ player: { id: playerId } }) as Session;

const incluidoDeFora = {
  temContaAtiva: true,
  jaEstaNoFut: false,
  elegivel: true,
  recusou: false,
};

// As transições que `entrarNaLista` devolve. Quem decide o aviso é ela, e não
// mais `alvo.jaEstaNoFut` — ver o comentário de mereceAviso.
const entrou = { de: null, para: "in" } as const;
const voltou = { de: "out", para: "in" } as const;
const reconfirmou = { de: "in", para: "in" } as const;
const foiParaEspera = { de: null, para: "waitlist" } as const;
const caiuParaEspera = { de: "in", para: "waitlist" } as const;
const seguiuNaEspera = { de: "waitlist", para: "waitlist" } as const;

describe("mereceAviso", () => {
  // Exatamente o caso que a exceção da lista fechada abriu: alguém com conta
  // sendo posto no fut por outra pessoa.
  it("avisa quem tem conta, estava fora e foi posto por outro", () => {
    expect(mereceAviso(sessaoDe(1), 2, incluidoDeFora, entrou)).toBe(true);
  });

  // O buraco que a troca de `jaEstaNoFut` pela transição fechou: linha `out` é
  // linha, então quem tinha marcado "Fora" e era reposto pelo organizador não
  // recebia aviso NENHUM — a pessoa com mais motivo para receber.
  it("avisa quem tinha marcado Fora e foi reposto por outro", () => {
    expect(mereceAviso(sessaoDe(1), 2, { ...incluidoDeFora, jaEstaNoFut: true }, voltou)).toBe(
      true,
    );
  });

  it("não avisa o próprio ator do que ele mesmo fez", () => {
    expect(mereceAviso(sessaoDe(2), 2, incluidoDeFora, entrou)).toBe(false);
  });

  it("não avisa quem não tem conta ativa — não há onde receber", () => {
    expect(
      mereceAviso(sessaoDe(1), 2, { ...incluidoDeFora, temContaAtiva: false }, entrou),
    ).toBe(false);
  });

  // A tela é idempotente: clicar "Vai" em quem já está `in` não é evento novo.
  it("não avisa quem já ocupava vaga — não é novidade", () => {
    expect(mereceAviso(sessaoDe(1), 2, incluidoDeFora, reconfirmou)).toBe(false);
  });

  // Ser posto na espera por outra pessoa também é novidade. Exigir vaga aqui
  // silenciava a inclusão de terceiro em fut lotado: `avisoDePromocao` só sai SE
  // abrir vaga, então a pessoa podia nunca saber que a puseram numa fila.
  it("avisa quem foi posto na espera por outro", () => {
    expect(mereceAviso(sessaoDe(1), 2, incluidoDeFora, foiParaEspera)).toBe(true);
  });

  // Rebaixamento não é inclusão: quem já tinha vaga e caiu para a espera não
  // recebe "marcaram sua presença".
  it("não avisa quem saiu da vaga para a espera", () => {
    expect(mereceAviso(sessaoDe(1), 2, incluidoDeFora, caiuParaEspera)).toBe(false);
  });

  // O mesmo status de novo é a tela sendo idempotente, na espera como na vaga.
  it("não avisa quem já estava na espera e continuou nela", () => {
    expect(mereceAviso(sessaoDe(1), 2, incluidoDeFora, seguiuNaEspera)).toBe(false);
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
