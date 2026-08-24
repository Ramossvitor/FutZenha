"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { RecargaStatus } from "@/db/schema";
import { requirePlayer } from "@/lib/require-player";
import { criarPedido, sondarPedido } from "@/lib/recarga";

/**
 * O id do pacote, vindo do `.bind` — corpo de POST, endereço de cliente. O zod
 * garante que é um id plausível; quem decide se ele existe e está à venda é
 * `criarPedido`, contra o banco.
 */
const idSchema = z.number().int().positive();

/**
 * Cria o pedido e leva para a tela do QR.
 *
 * O destino do sucesso é a tela do PEDIDO, não um banner: o que a pessoa
 * precisa agora é do código para pagar, e a tela é revisitável — aba fechada,
 * link reaberto, o QR continua lá até expirar.
 */
export async function criarRecarga(pacoteId: number) {
  const session = await requirePlayer();

  const parsed = idSchema.safeParse(pacoteId);
  // Os slugs vão ESCRITOS, um por linha — regra do teste de cobertura de
  // src/lib/mensagens.ts, como em src/app/loja/actions.ts.
  if (!parsed.success) redirect("/zenhas/recarga?erro=pacote-indisponivel");

  const resultado = await criarPedido(session.player.id, parsed.data);
  if (resultado === "pacote-indisponivel") redirect("/zenhas/recarga?erro=pacote-indisponivel");
  if (resultado === "gateway-indisponivel") redirect("/zenhas/recarga?erro=gateway-indisponivel");

  redirect(`/zenhas/recarga/${resultado.id}`);
}

/**
 * A sonda da tela do pedido: devolve o status atual, consultando o gateway
 * quando vale a pena (ver `sondarPedido`). Chamada pelo client component em
 * intervalo — e por isso devolve dado em vez de redirecionar: quem decide
 * recarregar a tela é quem está com ela aberta.
 *
 * `revalidatePath` no crédito: o chip de saldo do topo e a página /zenhas
 * ficam certos já no refresh que a sonda dispara.
 */
export async function statusDaRecarga(pedidoId: number): Promise<RecargaStatus | null> {
  const session = await requirePlayer();

  const parsed = idSchema.safeParse(pedidoId);
  if (!parsed.success) return null;

  const pedido = await sondarPedido(session.player.id, parsed.data);
  if (pedido === null) return null;

  if (pedido.status === "pago") {
    revalidatePath("/zenhas");
    revalidatePath("/zenhas/recarga");
    revalidatePath(`/zenhas/recarga/${pedido.id}`);
  }
  return pedido.status;
}
