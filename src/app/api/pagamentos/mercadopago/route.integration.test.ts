// O webhook do Mercado Pago, de ponta a ponta: a assinatura HMAC de verdade, a
// consulta de volta (fetch stubado com token FAKE — o kill switch do setup
// garante que o real nunca vaza para cá) e as transições no banco.
//
// O que este arquivo vigia que os testes de domínio não alcançam: a rota
// FECHADA sem secret, o 401 do forjador, e o contrato de "o corpo nunca
// decide" — o status vem da consulta, não do payload.

import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { zenhaLedger, zenhaPedidos } from "@/db/schema";
import { montarManifest } from "@/lib/pagamentos/mercadopago";
import { POST } from "./route";
import { criarJogadorComConta } from "@/test/fixtures";
import { criarPacote, criarPedidoDireto } from "@/test/fixtures-recarga";

const SECRET = "secret-de-webhook-de-teste";

// O stub de env não é limpo pelo clearAllMocks do setup — sem isto, a secret de
// um teste vazaria para o teste do 503.
afterEach(() => {
  vi.unstubAllEnvs();
});

function stubDeCredenciais(): void {
  vi.stubEnv("MP_WEBHOOK_SECRET", SECRET);
  // Token FAKE: a consulta de volta passa pelo transporte real, contra o fetch
  // stubado abaixo — nunca contra o MP.
  vi.stubEnv("MP_ACCESS_TOKEN", "TEST-fake-token");
}

function stubDeConsulta(payload: unknown, status = 200): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(
    async () => new Response(JSON.stringify(payload), { status }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Bem fora da JANELA_DA_ASSINATURA_MS de cinco minutos. */
const DEZ_MINUTOS_ATRAS = () => Math.floor(Date.now() / 1000) - 600;

/** Um POST assinado como o MP assina: HMAC do manifest com a secret. */
function requisicao(opcoes: {
  dataId: string | null;
  corpo?: unknown;
  assinaturaValida?: boolean;
  tsSegundos?: number;
}): Request {
  const { dataId, corpo = { type: "payment", data: { id: dataId } }, assinaturaValida = true } = opcoes;
  const requestId = "req-de-teste";
  // O `ts` é do AGORA, e não um literal de 2024: a rota confere o frescor da
  // assinatura (JANELA_DA_ASSINATURA_MS), e um carimbo congelado no passado
  // faria todo caso aqui bater no 401 da janela em vez do que ele quer provar.
  const ts = String(opcoes.tsSegundos ?? Math.floor(Date.now() / 1000));
  const v1 = createHmac("sha256", assinaturaValida ? SECRET : "outra-secret")
    .update(montarManifest(dataId, requestId, ts))
    .digest("hex");

  const url =
    dataId === null
      ? "http://localhost/api/pagamentos/mercadopago"
      : `http://localhost/api/pagamentos/mercadopago?data.id=${encodeURIComponent(dataId)}`;
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-signature": `ts=${ts},v1=${v1}`,
      "x-request-id": requestId,
    },
    body: JSON.stringify(corpo),
  });
}

describe("POST /api/pagamentos/mercadopago", () => {
  it("sem secret a rota fica fechada — 503, como o cron", async () => {
    // Explícito, e não confiando no ambiente: um .env local com a secret de
    // verdade não pode fazer este teste mentir.
    vi.stubEnv("MP_WEBHOOK_SECRET", "");
    const resposta = await POST(requisicao({ dataId: "1" }));
    expect(resposta.status).toBe(503);
  });

  it("assinatura de outra secret é 401", async () => {
    stubDeCredenciais();
    const resposta = await POST(requisicao({ dataId: "1", assinaturaValida: false }));
    expect(resposta.status).toBe(401);
  });

  // A assinatura é boa, o carimbo é que é velho: um webhook capturado uma vez
  // não vale para sempre.
  it("assinatura válida com ts fora da janela é 401", async () => {
    stubDeCredenciais();
    const fetchMock = stubDeConsulta({});

    const resposta = await POST(requisicao({ dataId: "1", tsSegundos: DEZ_MINUTOS_ATRAS() }));

    expect(resposta.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("pagamento aprovado credita — e o retry do MP é no-op", async () => {
    stubDeCredenciais();
    const { jogador } = await criarJogadorComConta();
    const pacote = await criarPacote({ zenhas: 550 });
    const pedido = await criarPedidoDireto(jogador.id, pacote);
    stubDeConsulta({ id: pedido.gatewayId, status: "approved" });

    const primeira = await POST(requisicao({ dataId: pedido.gatewayId! }));
    const segunda = await POST(requisicao({ dataId: pedido.gatewayId! }));

    expect(primeira.status).toBe(200);
    expect(segunda.status).toBe(200);
    const [depois] = await db.select().from(zenhaPedidos).where(eq(zenhaPedidos.id, pedido.id));
    expect(depois.status).toBe("pago");
    const linhas = await db
      .select()
      .from(zenhaLedger)
      .where(eq(zenhaLedger.playerId, jogador.id));
    expect(linhas).toHaveLength(1);
    expect(linhas[0].amount).toBe(550);
  });

  // O corpo diz "approved", a consulta diz pendente: NADA muda. É o contrato
  // que torna inócuo um webhook forjado que passasse pela assinatura.
  it("o corpo do webhook nunca decide — quem manda é a consulta", async () => {
    stubDeCredenciais();
    const { jogador } = await criarJogadorComConta();
    const pacote = await criarPacote();
    const pedido = await criarPedidoDireto(jogador.id, pacote);
    stubDeConsulta({ id: pedido.gatewayId, status: "pending" });

    const resposta = await POST(
      requisicao({
        dataId: pedido.gatewayId!,
        corpo: { type: "payment", data: { id: pedido.gatewayId, status: "approved" } },
      }),
    );

    expect(resposta.status).toBe(200);
    const [depois] = await db.select().from(zenhaPedidos).where(eq(zenhaPedidos.id, pedido.id));
    expect(depois.status).toBe("pendente");
    expect(await db.select().from(zenhaLedger).where(eq(zenhaLedger.playerId, jogador.id))).toHaveLength(0);
  });

  it("estorno marca o pedido pago como estornado", async () => {
    stubDeCredenciais();
    const { jogador } = await criarJogadorComConta();
    const pacote = await criarPacote();
    const pedido = await criarPedidoDireto(jogador.id, pacote, { status: "pago" });
    stubDeConsulta({ id: pedido.gatewayId, status: "refunded" });

    const resposta = await POST(requisicao({ dataId: pedido.gatewayId! }));

    expect(resposta.status).toBe(200);
    const [depois] = await db.select().from(zenhaPedidos).where(eq(zenhaPedidos.id, pedido.id));
    expect(depois.status).toBe("estornado");
  });

  it("pagamento que não é nosso responde 200 sem consultar — nada a retentar", async () => {
    stubDeCredenciais();
    const fetchMock = stubDeConsulta({});

    const resposta = await POST(requisicao({ dataId: "id-de-outro-sistema" }));

    expect(resposta.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("tópico que não é payment responde 200 e para ali", async () => {
    stubDeCredenciais();
    const fetchMock = stubDeConsulta({});

    const resposta = await POST(
      requisicao({ dataId: "123", corpo: { type: "subscription_preapproval" } }),
    );

    expect(resposta.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("consulta que falhou responde 500 — o retry do MP é o que se quer", async () => {
    stubDeCredenciais();
    const { jogador } = await criarJogadorComConta();
    const pacote = await criarPacote();
    const pedido = await criarPedidoDireto(jogador.id, pacote);
    stubDeConsulta({ message: "internal" }, 500);

    const resposta = await POST(requisicao({ dataId: pedido.gatewayId! }));

    expect(resposta.status).toBe(500);
    const [depois] = await db.select().from(zenhaPedidos).where(eq(zenhaPedidos.id, pedido.id));
    expect(depois.status).toBe("pendente");
  });
});
