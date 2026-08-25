"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { comprar } from "@/lib/loja";
import { requirePlayer } from "@/lib/require-player";

/**
 * O id do item, vindo do `.bind` — ou seja, do corpo do POST, que é endereço de
 * cliente. O zod garante que é um id plausível; quem decide se ele EXISTE e se
 * está à venda é `comprar`, DENTRO da transação — conferir aqui abriria a janela
 * entre a conferência e a cobrança.
 */
const idSchema = z.number().int().positive();

/**
 * Compra e leva para o inventário.
 *
 * O destino do sucesso é `/perfil/inventario`, e não a loja: comprar já COLOCA o
 * item (badge na vitrine, cosmético no slot vazio), e o inventário é onde se vê
 * onde ele foi parar e se troca de ideia. O caminho de volta à loja está a um
 * toque de lá.
 *
 * A recusa volta para a confirmação, e não para a vitrine: é a tela que mostra o
 * preço e o saldo, que é exatamente o que o banner vai comentar.
 */
export async function comprarItem(itemId: number) {
  const session = await requirePlayer();

  const parsed = idSchema.safeParse(itemId);
  // Id absurdo não tem página de confirmação para onde voltar — o banner iria
  // para a vitrine.
  if (!parsed.success) redirect("/loja?erro=item-indisponivel");

  const erro = await comprar(session.player.id, parsed.data);

  // Os slugs vão ESCRITOS, um por linha, e não interpolados: o teste de
  // cobertura de src/lib/mensagens.ts varre o FONTE atrás do par erro=… na query
  // string, e uma interpolação faria a varredura não achar nenhum deles — o dia
  // em que um destes ficasse sem mensagem, o banner sumiria calado.
  if (erro === "sem-saldo") redirect(`/loja/${parsed.data}?erro=sem-saldo`);
  if (erro === "ja-possui") redirect(`/loja/${parsed.data}?erro=ja-possui`);
  // Item que não existe não tem tela de confirmação: o banner iria para o vazio.
  if (erro) redirect("/loja?erro=item-indisponivel");

  revalidatePath("/loja");
  revalidatePath("/zenhas");
  revalidatePath("/perfil/inventario");
  revalidatePath(`/jogador/${session.player.slug}`);
  redirect("/perfil/inventario?ok=compra-feita");
}
