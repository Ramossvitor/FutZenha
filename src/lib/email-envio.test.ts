import { describe, expect, it } from "vitest";
import { classificarStatusResend } from "./email-envio";

describe("classificarStatusResend", () => {
  it("2xx é sucesso", () => {
    expect(classificarStatusResend(200)).toEqual({ ok: true });
    expect(classificarStatusResend(201)).toEqual({ ok: true });
  });

  // O mesmo 429 cobre o rate limit por segundo e a cota diária do free tier —
  // o admin resolve os dois do mesmo jeito (WhatsApp), então é um motivo só.
  it("429 é limite", () => {
    expect(classificarStatusResend(429)).toEqual({ ok: false, motivo: "limite" });
  });

  it("demais 4xx são recusa de configuração ou payload", () => {
    for (const status of [400, 401, 403, 422]) {
      expect(classificarStatusResend(status)).toEqual({ ok: false, motivo: "recusado" });
    }
  });

  it("5xx é indisponibilidade do Resend", () => {
    for (const status of [500, 502, 503]) {
      expect(classificarStatusResend(status)).toEqual({ ok: false, motivo: "indisponivel" });
    }
  });

  // Os interiores acima passariam com qualquer comparação frouxa. Estas são as
  // bordas: um `<= 300` no lugar do `< 300` transformaria um redirect em
  // "enviado", e um `>= 499` engoliria o primeiro 5xx como recusa de payload.
  it("as bordas de cada faixa caem do lado certo", () => {
    expect(classificarStatusResend(299)).toEqual({ ok: true });
    expect(classificarStatusResend(400)).toEqual({ ok: false, motivo: "recusado" });
    expect(classificarStatusResend(499)).toEqual({ ok: false, motivo: "recusado" });
    expect(classificarStatusResend(500)).toEqual({ ok: false, motivo: "indisponivel" });
  });

  // O fetch já segue redirect sozinho, então 3xx aqui é o endpoint ter mudado de
  // lugar. Fica junto do 5xx de propósito — nada que o admin resolva.
  it("3xx é tratado como indisponibilidade, não como sucesso", () => {
    for (const status of [301, 302, 307]) {
      expect(classificarStatusResend(status)).toEqual({ ok: false, motivo: "indisponivel" });
    }
  });
});
