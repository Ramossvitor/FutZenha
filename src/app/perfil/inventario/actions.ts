"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { zenhaSlotEnum } from "@/db/schema";
import { desequipar, equipar } from "@/lib/loja";
import { requirePlayer } from "@/lib/require-player";

// Os dois valores chegam pelo `.bind`, ou seja, viajam no corpo do POST — são
// endereço de cliente e nada mais. A posse do item é reconferida dentro de
// `equipar` (o `player_id` está no WHERE), e o slot é validado contra o ENUM DO
// BANCO em vez de uma lista repetida aqui: slot novo na migration não pode
// deixar esta validação para trás.

const idSchema = z.number().int().positive();
const slotSchema = z.enum(zenhaSlotEnum.enumValues);

/**
 * Põe o item no slot dele.
 *
 * Revalida também o perfil público: é lá que o cosmético aparece, e é o primeiro
 * lugar para onde a pessoa vai olhar depois de equipar.
 */
export async function equiparItem(inventarioId: number) {
  const session = await requirePlayer();

  const parsed = idSchema.safeParse(inventarioId);
  if (!parsed.success) redirect("/perfil/inventario?erro=dados-invalidos");

  const erro = await equipar(session.player.id, parsed.data);
  if (erro) redirect("/perfil/inventario?erro=item-nao-e-seu");

  revalidatePath("/perfil/inventario");
  revalidatePath(`/jogador/${session.player.id}`);
  redirect("/perfil/inventario?ok=item-equipado");
}

/**
 * Esvazia o slot.
 *
 * Sem caminho de erro: desequipar o que já não está equipado é o estado que a
 * pessoa pediu, e `desequipar` não distingue os dois casos de propósito — um
 * banner vermelho para o segundo toque no mesmo botão seria ruído.
 */
export async function desequiparSlot(slot: string) {
  const session = await requirePlayer();

  const parsed = slotSchema.safeParse(slot);
  if (!parsed.success) redirect("/perfil/inventario?erro=dados-invalidos");

  await desequipar(session.player.id, parsed.data);

  revalidatePath("/perfil/inventario");
  revalidatePath(`/jogador/${session.player.id}`);
  redirect("/perfil/inventario?ok=item-desequipado");
}
