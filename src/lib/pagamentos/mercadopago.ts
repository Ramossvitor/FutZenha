// O transporte do Mercado Pago — a única peça do projeto que fala com ele.
//
// Fetch cru em vez do SDK, pelo mesmo motivo do Resend (src/lib/email-envio.ts)
// e do OAuth: são dois endpoints e um parse de status, e o SDK só embrulharia
// isso ao custo de uma dependência. Sem `server-only` pelo mesmo precedente — a
// parte que merece teste (`classificarStatusMP`, `montarManifest`,
// `validarAssinaturaMP`, `valorEmReais`) é pura e o vitest a alcança sem mock.
//
// Credenciais: `MP_ACCESS_TOKEN` (a de produção começa com APP_USR-, a de teste
// com TEST-) e `MP_WEBHOOK_SECRET` (a "assinatura secreta" do painel de
// webhooks). A AUSÊNCIA do token é o kill switch — igual à RESEND_API_KEY: sem
// ele a UI de recarga some e nenhum caminho fala com o gateway. O setup de
// integração aborta se o token existir no ambiente (src/test/setup-integration.ts).
//
// Sem retry em nenhuma chamada, ao contrário do e-mail: a criação da cobrança é
// idempotente DO LADO DE LÁ (X-Idempotency-Key), então quem falhou aqui pode
// simplesmente tentar de novo pela UI; e a consulta é chamada pela varredura,
// que já volta sozinha no próximo ciclo.

import { createHmac } from "node:crypto";
import { segredoConfere } from "../segredo";
import type {
  GatewayDePagamento,
  NovaCobrancaPix,
  ResultadoConsulta,
  ResultadoCriacao,
  StatusNoGateway,
} from "./gateway";

const MP_ENDPOINT = "https://api.mercadopago.com";
const TIMEOUT_MS = 10_000;

/** Espelho do emailConfigurado: a UI esconde a recarga em ambiente sem token. */
export function mercadoPagoConfigurado(): boolean {
  return Boolean(process.env.MP_ACCESS_TOKEN);
}

/**
 * Centavos → o decimal que o `transaction_amount` do MP exige.
 *
 * A ÚNICA linha do sistema onde dinheiro vira ponto flutuante, e ela é segura:
 * todo múltiplo de 0,01 até R$ 1.000,00 tem representação exata o bastante para
 * duas casas — o `toFixed(2)` corta qualquer resíduo binário antes de o número
 * virar JSON.
 */
export function valorEmReais(centavos: number): number {
  return Number((centavos / 100).toFixed(2));
}

/**
 * O contrato de status do MP, isolado para teste.
 *
 * `approved` é o único que credita. `pending`/`in_process`/`authorized` seguem
 * pendentes. `cancelled` é como o MP marca o Pix que venceu sem pagamento (e o
 * cancelado à mão); `rejected` e `expired` caem junto — para a recarga os três
 * são o mesmo fato: este QR não vai mais ser pago. `refunded` e `charged_back`
 * são o dinheiro voltando DEPOIS de pago — o caso que vira aviso aos admins.
 *
 * Status desconhecido fica `pendente` de propósito: é o único palpite que não
 * queima nada — não credita, não expira, e a próxima consulta decide.
 */
export function classificarStatusMP(status: unknown): StatusNoGateway {
  switch (status) {
    case "approved":
      return "pago";
    case "cancelled":
    case "rejected":
    case "expired":
      return "expirado";
    case "refunded":
    case "charged_back":
      return "estornado";
    default:
      return "pendente";
  }
}

/**
 * O manifest que o MP assina, letra por letra do template documentado:
 * `id:{data.id};request-id:{x-request-id};ts:{ts};` — segmento ausente sai
 * INTEIRO (a doc manda remover, não deixar vazio). O `data.id` vai minúsculo
 * quando alfanumérico, também por contrato.
 */
export function montarManifest(
  dataId: string | null,
  requestId: string | null,
  ts: string,
): string {
  const partes: string[] = [];
  if (dataId !== null && dataId !== "") partes.push(`id:${dataId.toLowerCase()};`);
  if (requestId !== null && requestId !== "") partes.push(`request-id:${requestId};`);
  partes.push(`ts:${ts};`);
  return partes.join("");
}

/**
 * Por quanto tempo uma assinatura vale. O `ts` entra no manifest assinado, mas
 * assinar o instante não serve de nada se ninguém o confere: sem esta janela, um
 * webhook válido capturado uma vez é reenviável para sempre.
 *
 * O estrago de um replay é pequeno por desenho (quem decide o status é a
 * consulta autenticada, e toda transição é `UPDATE ... WHERE status`), então a
 * janela é generosa — cinco minutos cobrem a fila de retry do MP e qualquer
 * deriva de relógio plausível entre a nossa função e a borda deles.
 */
export const JANELA_DA_ASSINATURA_MS = 5 * 60_000;

/**
 * Confere o `x-signature` de um webhook. Puro: recebe a secret (e o instante)
 * em vez de ler o ambiente ou o relógio, para o teste não precisar stubar nada.
 *
 * O header vem como `ts=...,v1=...`. Qualquer pedaço faltando é assinatura
 * inválida — nunca "sem assinatura, deixa passar": um webhook sem prova de
 * origem é exatamente o que um forjador mandaria. A comparação final é a de
 * tempo constante de src/lib/segredo.ts.
 *
 * O `ts` do MP é epoch em SEGUNDOS. Fora da janela é recusa, dos dois lados:
 * antigo demais é replay, futuro demais é relógio que não dá para acreditar.
 */
export function validarAssinaturaMP(
  xSignature: string | null,
  xRequestId: string | null,
  dataId: string | null,
  secret: string,
  agoraMs: number = Date.now(),
): boolean {
  if (!xSignature) return false;

  let ts: string | null = null;
  let v1: string | null = null;
  for (const parte of xSignature.split(",")) {
    const [chave, ...resto] = parte.split("=");
    const valor = resto.join("=").trim();
    if (chave.trim() === "ts") ts = valor;
    if (chave.trim() === "v1") v1 = valor;
  }
  if (!ts || !v1) return false;

  // Antes do HMAC: um `ts` que nem é número não merece o custo do hash.
  const tsMs = Number(ts) * 1000;
  if (!Number.isFinite(tsMs) || Math.abs(agoraMs - tsMs) > JANELA_DA_ASSINATURA_MS) return false;

  const esperado = createHmac("sha256", secret)
    .update(montarManifest(dataId, xRequestId, ts))
    .digest("hex");
  return segredoConfere(v1, esperado);
}

// O corpo de erro do MP traz `message`/`error`; o que importa para o log é o
// texto cru — o token nunca é logado.
async function corpoDaResposta(resposta: Response): Promise<string> {
  return resposta.text().catch(() => "");
}

/**
 * Cria a cobrança Pix: `POST /v1/payments` com `payment_method_id: "pix"`.
 *
 * O `X-Idempotency-Key` é o que torna o retry de quem chama seguro: a mesma
 * chave devolve o MESMO pagamento em vez de criar outro. `external_reference`
 * carrega a chave também — é por ela que um pagamento órfão (webhook de um
 * pedido que não gravou) ainda é rastreável no painel do MP.
 */
async function criarCobrancaPix(cobranca: NovaCobrancaPix): Promise<ResultadoCriacao> {
  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) return { ok: false, motivo: "nao-configurado" };

  // O MP exige `date_of_expiration` com offset explícito ("+00:00", nunca o
  // "Z" do toISOString — o parser deles recusa o literal).
  const expira = new Date(Date.now() + cobranca.expiraEmMinutos * 60_000)
    .toISOString()
    .replace("Z", "+00:00");

  let resposta: Response;
  try {
    resposta = await fetch(`${MP_ENDPOINT}/v1/payments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": cobranca.idempotencyKey,
      },
      body: JSON.stringify({
        transaction_amount: valorEmReais(cobranca.valorCentavos),
        description: cobranca.descricao,
        payment_method_id: "pix",
        payer: { email: cobranca.emailPagador },
        external_reference: cobranca.idempotencyKey,
        date_of_expiration: expira,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (erro) {
    console.error("[mercadopago] criação de cobrança não chegou ao MP:", erro);
    return { ok: false, motivo: "indisponivel" };
  }

  const corpo = await corpoDaResposta(resposta);
  if (!resposta.ok) {
    console.error("[mercadopago] MP recusou a cobrança:", resposta.status, corpo);
    return { ok: false, motivo: resposta.status >= 500 ? "indisponivel" : "recusado" };
  }

  let json: unknown;
  try {
    json = JSON.parse(corpo);
  } catch {
    console.error("[mercadopago] resposta 2xx ilegível na criação:", corpo.slice(0, 500));
    return { ok: false, motivo: "indisponivel" };
  }

  // O caminho documentado do QR. Uma resposta 2xx sem ele é contrato quebrado
  // do lado de lá — melhor recusar aqui do que gravar um pedido sem QR que
  // ninguém tem como pagar.
  const dados =
    json && typeof json === "object"
      ? (json as {
          id?: unknown;
          point_of_interaction?: { transaction_data?: { qr_code?: unknown; qr_code_base64?: unknown } };
        })
      : null;
  const qrCode = dados?.point_of_interaction?.transaction_data?.qr_code;
  if (!dados || dados.id === undefined || typeof qrCode !== "string" || qrCode === "") {
    console.error("[mercadopago] cobrança criada sem QR na resposta:", corpo.slice(0, 500));
    return { ok: false, motivo: "indisponivel" };
  }

  const base64 = dados.point_of_interaction?.transaction_data?.qr_code_base64;
  return {
    ok: true,
    cobranca: {
      // O id vem numérico; `gateway_id` é text porque o formato é do gateway,
      // não nosso.
      gatewayId: String(dados.id),
      qrCode,
      qrCodeBase64: typeof base64 === "string" && base64 !== "" ? base64 : null,
    },
  };
}

/**
 * Consulta um pagamento: `GET /v1/payments/{id}`.
 *
 * É a ÚNICA fonte de verdade sobre status — o corpo de um webhook nunca é: o
 * webhook diz "olhe o pagamento X", e quem olha é isto (ver a rota em
 * src/app/api/pagamentos/mercadopago/route.ts).
 */
async function consultarPagamento(gatewayId: string): Promise<ResultadoConsulta> {
  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) return { ok: false, motivo: "nao-configurado" };

  let resposta: Response;
  try {
    resposta = await fetch(`${MP_ENDPOINT}/v1/payments/${encodeURIComponent(gatewayId)}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (erro) {
    console.error("[mercadopago] consulta não chegou ao MP:", erro);
    return { ok: false, motivo: "indisponivel" };
  }

  const corpo = await corpoDaResposta(resposta);
  if (resposta.status === 404) return { ok: false, motivo: "nao-encontrado" };
  if (!resposta.ok) {
    console.error("[mercadopago] consulta recusada:", resposta.status, corpo);
    return { ok: false, motivo: "indisponivel" };
  }

  let json: unknown;
  try {
    json = JSON.parse(corpo);
  } catch {
    console.error("[mercadopago] resposta 2xx ilegível na consulta:", corpo.slice(0, 500));
    return { ok: false, motivo: "indisponivel" };
  }

  const status =
    json && typeof json === "object" && "status" in json ? (json as { status: unknown }).status : null;
  return { ok: true, status: classificarStatusMP(status), bruto: json };
}

export const mercadoPago: GatewayDePagamento = {
  nome: "mercadopago",
  configurado: mercadoPagoConfigurado,
  criarCobrancaPix,
  consultarPagamento,
};
