"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { comprar } from "@/lib/loja";
import { ehIdDeItem, type IdDeItem } from "@/lib/loja-catalogo";
import { requirePlayer } from "@/lib/require-player";

/**
 * O id do item, vindo do `.bind` — ou seja, do corpo do POST, que é endereço de
 * cliente. O zod garante que é string; quem decide se ela EXISTE é o catálogo,
 * porque o conjunto de ids mora lá e uma lista repetida aqui divergiria no
 * primeiro item novo.
 */
const idSchema = z.string().refine((valor): valor is IdDeItem => ehIdDeItem(valor));

/**
 * Compra e leva para o inventário.
 *
 * O destino do sucesso é `/perfil/inventario`, e não a loja: o que a pessoa
 * acabou de comprar precisa ser EQUIPADO (ou armado, no caso do multiplicador)
 * para servir de alguma coisa, e voltar para a vitrine com um banner deixaria a
 * metade que importa por fazer. O caminho de volta à loja está a um toque de lá.
 *
 * A recusa volta para a confirmação, e não para a vitrine: é a tela que mostra o
 * preço e o saldo, que é exatamente o que o banner vai comentar.
 */
export async function comprarItem(itemId: string) {
  const session = await requirePlayer();

  const parsed = idSchema.safeParse(itemId);
  // Id que o catálogo não conhece não tem página de confirmação para onde
  // voltar — o banner iria para a vitrine.
  if (!parsed.success) redirect("/loja?erro=item-indisponivel");

  const erro = await comprar(session.player.id, parsed.data);

  // Os slugs vão ESCRITOS, um por linha, e não interpolados: o teste de
  // cobertura de src/lib/mensagens.ts varre o FONTE atrás do par erro=… na query
  // string, e uma interpolação faria a varredura não achar nenhum deles — o dia
  // em que um destes ficasse sem mensagem, o banner sumiria calado.
  if (erro === "sem-saldo") redirect(`/loja/${parsed.data}?erro=sem-saldo`);
  if (erro === "ja-possui") redirect(`/loja/${parsed.data}?erro=ja-possui`);
  if (erro) redirect(`/loja/${parsed.data}?erro=item-indisponivel`);

  revalidatePath("/loja");
  revalidatePath("/zenhas");
  revalidatePath("/perfil/inventario");
  redirect("/perfil/inventario?ok=compra-feita");
}
