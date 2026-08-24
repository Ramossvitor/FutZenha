import { validarAssinaturaMP, mercadoPago } from "@/lib/pagamentos/mercadopago";
import { confirmarPedido, lerPedidoPorGatewayId, registrarEstorno } from "@/lib/recarga";
import { db } from "@/db";
import { zenhaPedidos } from "@/db/schema";
import { and, eq } from "drizzle-orm";

// O webhook do Mercado Pago — o caminho principal da confirmação de recarga.
// (A rede de segurança é a varredura de src/lib/recarga.ts, que consulta os
// pendentes por conta própria: um webhook perdido atrasa o crédito, não o perde.)
//
// Atenção: /api/* NÃO passa pelo src/proxy.ts (o matcher cobre só as áreas de
// admin e de jogador). Esta rota se autentica sozinha — pela assinatura HMAC
// que o MP manda no header `x-signature`, validada contra a MP_WEBHOOK_SECRET.
//
// O corpo do webhook NUNCA decide nada: ele diz "olhe o pagamento X", e o
// status vem de volta pela consulta autenticada à API. É o que torna inócuo até
// um webhook forjado que passasse pela assinatura — forjar o pagamento em si
// exigiria o access token.
//
// A resposta é 200 mesmo para evento desconhecido ou pedido não encontrado: o
// MP retenta a cada 15 minutos o que não for 2xx, e um 4xx aqui viraria uma
// fila infinita de retries por um evento que nunca vamos tratar. Os únicos
// não-2xx são os de autenticação — 503 sem secret (rota fechada, como o cron) e
// 401 em assinatura inválida.
//
// `Request`/`Response` puros, e não NextRequest/NextResponse, como na rota de
// imagens: a rota não usa nada que só o wrapper dá, e é o par puro que o teste
// de integração consegue construir (o harness mocka next/server).
export const dynamic = "force-dynamic";

// O prazo de confirmação do MP é 22s; o teto declarado deixa folga para a
// consulta de volta (10s de timeout) mais as transições no banco.
export const maxDuration = 30;

export async function POST(request: Request) {
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret) {
    return Response.json({ erro: "MP_WEBHOOK_SECRET não configurado." }, { status: 503 });
  }

  // O `data.id` da QUERY STRING é o que entra no manifest assinado — contrato
  // do MP, mesmo quando o corpo carrega o mesmo id.
  const dataId = new URL(request.url).searchParams.get("data.id");
  const valida = validarAssinaturaMP(
    request.headers.get("x-signature"),
    request.headers.get("x-request-id"),
    dataId,
    secret,
  );
  if (!valida) return Response.json({ erro: "Assinatura inválida." }, { status: 401 });

  // O corpo é lido só para descartar tópicos que não são de pagamento (o painel
  // permite assinar vários). Ilegível é tratado como pagamento: na dúvida,
  // consultar é barato e não decide nada sozinho.
  const corpo: unknown = await request.json().catch(() => null);
  const tipo =
    corpo && typeof corpo === "object" && "type" in corpo ? (corpo as { type: unknown }).type : null;
  if (typeof tipo === "string" && tipo !== "payment") return Response.json({ ok: true });

  if (!dataId) return Response.json({ ok: true });

  const pedido = await lerPedidoPorGatewayId(dataId);
  // Pagamento que não é nosso (outro sistema na mesma conta MP, ou a cobrança
  // órfã de um insert que falhou). Nada a fazer — e nada a retentar.
  if (!pedido) return Response.json({ ok: true });

  const consulta = await mercadoPago.consultarPagamento(dataId);
  if (!consulta.ok) {
    // Aqui SIM um 500: o MP retentar daqui a 15 minutos é exatamente o que se
    // quer quando a consulta de volta falhou — e a varredura cobre o meio tempo.
    return Response.json({ erro: "Consulta ao gateway falhou." }, { status: 500 });
  }

  if (consulta.status === "pago") {
    await confirmarPedido(db, pedido.id, consulta.bruto);
  } else if (consulta.status === "estornado") {
    await registrarEstorno(db, pedido.id, consulta.bruto);
  } else if (consulta.status === "expirado") {
    await db
      .update(zenhaPedidos)
      .set({ status: "expirado", ultimoEvento: consulta.bruto })
      .where(and(eq(zenhaPedidos.id, pedido.id), eq(zenhaPedidos.status, "pendente")));
  }
  // `pendente` não escreve nada: o evento só disse que o pagamento existe.

  return Response.json({ ok: true });
}
