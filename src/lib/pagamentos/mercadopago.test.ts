// A parte pura do transporte do Mercado Pago: a conversão de centavos, a
// tradução de status e — a que mais importa errar cedo — a assinatura do
// webhook, conferida contra um HMAC calculado aqui no teste com a mesma receita
// documentada. Se o manifest mudar uma vírgula, é este arquivo que grita, e não
// um webhook de produção caindo em 401 silencioso.

import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  classificarStatusMP,
  JANELA_DA_ASSINATURA_MS,
  montarManifest,
  valorEmReais,
  validarAssinaturaMP,
} from "./mercadopago";

describe("valorEmReais", () => {
  it("converte centavos para o decimal do MP", () => {
    expect(valorEmReais(1000)).toBe(10);
    expect(valorEmReais(1050)).toBe(10.5);
    expect(valorEmReais(1)).toBe(0.01);
    expect(valorEmReais(100000)).toBe(1000);
  });

  // 19,99 é o clássico do binário: 1999/100 = 19.990000000000002 sem o corte.
  it("corta o resíduo binário em duas casas", () => {
    expect(valorEmReais(1999)).toBe(19.99);
    expect(valorEmReais(2003)).toBe(20.03);
  });
});

describe("classificarStatusMP", () => {
  it("só approved credita", () => {
    expect(classificarStatusMP("approved")).toBe("pago");
  });

  it("os três jeitos de o QR morrer viram expirado", () => {
    expect(classificarStatusMP("cancelled")).toBe("expirado");
    expect(classificarStatusMP("rejected")).toBe("expirado");
    expect(classificarStatusMP("expired")).toBe("expirado");
  });

  it("dinheiro voltando vira estornado", () => {
    expect(classificarStatusMP("refunded")).toBe("estornado");
    expect(classificarStatusMP("charged_back")).toBe("estornado");
  });

  // Pendente é o único palpite que não queima nada: não credita nem expira.
  it("o que não se conhece fica pendente", () => {
    expect(classificarStatusMP("pending")).toBe("pendente");
    expect(classificarStatusMP("in_process")).toBe("pendente");
    expect(classificarStatusMP("um_status_novo_do_mp")).toBe("pendente");
    expect(classificarStatusMP(undefined)).toBe("pendente");
    expect(classificarStatusMP(null)).toBe("pendente");
  });
});

describe("montarManifest", () => {
  it("monta o template completo na ordem documentada", () => {
    expect(montarManifest("123", "req-1", "1704908010")).toBe(
      "id:123;request-id:req-1;ts:1704908010;",
    );
  });

  // A doc manda REMOVER o segmento ausente, não deixá-lo vazio.
  it("segmento ausente sai inteiro", () => {
    expect(montarManifest(null, "req-1", "1")).toBe("request-id:req-1;ts:1;");
    expect(montarManifest("123", null, "1")).toBe("id:123;ts:1;");
    expect(montarManifest(null, null, "1")).toBe("ts:1;");
  });

  it("o data.id alfanumérico vai minúsculo, por contrato", () => {
    expect(montarManifest("ABC123", "r", "1")).toBe("id:abc123;request-id:r;ts:1;");
  });
});

describe("validarAssinaturaMP", () => {
  const SECRET = "segredo-de-teste";
  /** O `ts` que os casos assinam, e o mesmo instante em ms — o relógio do teste. */
  const TS = "1704908010";
  const AGORA = Number(TS) * 1000;

  function assinar(dataId: string | null, requestId: string | null, ts: string): string {
    const v1 = createHmac("sha256", SECRET)
      .update(montarManifest(dataId, requestId, ts))
      .digest("hex");
    return `ts=${ts},v1=${v1}`;
  }

  it("aceita a assinatura calculada com a mesma receita", () => {
    const header = assinar("12345", "req-abc", TS);
    expect(validarAssinaturaMP(header, "req-abc", "12345", SECRET, AGORA)).toBe(true);
  });

  it("tolera espaços entre os pares do header", () => {
    const v1 = createHmac("sha256", SECRET)
      .update(montarManifest("9", "r", TS))
      .digest("hex");
    expect(validarAssinaturaMP(`ts=${TS}, v1=${v1}`, "r", "9", SECRET, AGORA)).toBe(true);
  });

  it("recusa v1 adulterado", () => {
    const header = assinar("12345", "req-abc", TS);
    const adulterado = header.slice(0, -1) + (header.endsWith("0") ? "1" : "0");
    expect(validarAssinaturaMP(adulterado, "req-abc", "12345", SECRET, AGORA)).toBe(false);
  });

  it("recusa quando o data.id da query não é o assinado", () => {
    const header = assinar("12345", "req-abc", TS);
    expect(validarAssinaturaMP(header, "req-abc", "99999", SECRET, AGORA)).toBe(false);
  });

  // Sem prova de origem não passa nada — um webhook sem header é exatamente o
  // que um forjador mandaria.
  it("recusa header ausente ou incompleto", () => {
    expect(validarAssinaturaMP(null, "r", "1", SECRET, AGORA)).toBe(false);
    expect(validarAssinaturaMP("", "r", "1", SECRET, AGORA)).toBe(false);
    expect(validarAssinaturaMP(`ts=${TS}`, "r", "1", SECRET, AGORA)).toBe(false);
    expect(validarAssinaturaMP("v1=abc", "r", "1", SECRET, AGORA)).toBe(false);
  });

  it("recusa a assinatura de outra secret", () => {
    const header = assinar("12345", "req-abc", TS);
    expect(validarAssinaturaMP(header, "req-abc", "12345", "outra-secret!!", AGORA)).toBe(false);
  });

  // A assinatura é boa, o instante é que não: sem esta janela, um webhook válido
  // capturado uma vez seria reenviável para sempre.
  it("recusa a assinatura válida cujo ts saiu da janela", () => {
    const header = assinar("12345", "req-abc", TS);
    const foraPorPouco = AGORA + JANELA_DA_ASSINATURA_MS + 1_000;
    expect(validarAssinaturaMP(header, "req-abc", "12345", SECRET, foraPorPouco)).toBe(false);
    // Dos dois lados: um ts no futuro é relógio em que não dá para acreditar.
    expect(
      validarAssinaturaMP(header, "req-abc", "12345", SECRET, AGORA - JANELA_DA_ASSINATURA_MS - 1_000),
    ).toBe(false);
  });

  it("aceita dentro da janela, nas duas direções", () => {
    const header = assinar("12345", "req-abc", TS);
    const quaseNoLimite = JANELA_DA_ASSINATURA_MS - 1_000;
    expect(validarAssinaturaMP(header, "req-abc", "12345", SECRET, AGORA + quaseNoLimite)).toBe(true);
    expect(validarAssinaturaMP(header, "req-abc", "12345", SECRET, AGORA - quaseNoLimite)).toBe(true);
  });

  it("recusa ts que não é número — sem pagar o custo do HMAC", () => {
    const v1 = createHmac("sha256", SECRET).update(montarManifest("1", "r", "ontem")).digest("hex");
    expect(validarAssinaturaMP(`ts=ontem,v1=${v1}`, "r", "1", SECRET, AGORA)).toBe(false);
  });
});
