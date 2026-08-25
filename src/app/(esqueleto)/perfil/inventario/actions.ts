"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { zenhaSlotEnum } from "@/db/schema";
import { desequipar, destacar, equipar, porNaVitrine, tirarDaVitrine } from "@/lib/loja";
import { requirePlayer } from "@/lib/require-player";

// Todo valor daqui chega pelo `.bind`, ou seja, viaja no corpo do POST — é
// endereço de cliente e nada mais. A posse do item é reconferida dentro de cada
// função de src/lib/loja.ts (o `player_id` está no WHERE), e o slot é validado
// contra o ENUM DO BANCO em vez de uma lista repetida aqui: slot novo na
// migration não pode deixar esta validação para trás.

const idSchema = z.number().int().positive();
const slotSchema = z.enum(zenhaSlotEnum.enumValues);

/**
 * Todas as escritas daqui mudam o que os OUTROS veem, então todas revalidam o
 * perfil público junto — é o primeiro lugar para onde a pessoa olha depois de
 * mexer, e é o que o link do zap abre.
 */
function revalidarVitrine(slugDoJogador: string): void {
  revalidatePath("/perfil/inventario");
  revalidatePath(`/jogador/${slugDoJogador}`);
}

/** Põe o item no slot dele (moldura, cor do nome ou título). */
export async function equiparItem(inventarioId: number) {
  const session = await requirePlayer();

  const parsed = idSchema.safeParse(inventarioId);
  if (!parsed.success) redirect("/perfil/inventario?erro=dados-invalidos");

  const erro = await equipar(session.player.id, parsed.data);
  if (erro) redirect("/perfil/inventario?erro=item-nao-e-seu");

  revalidarVitrine(session.player.slug);
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

  revalidarVitrine(session.player.slug);
  redirect("/perfil/inventario?ok=item-desequipado");
}

/**
 * Põe um badge na vitrine do perfil.
 *
 * A vitrine cheia é o único erro que a tela consegue prever e mesmo assim ele
 * chega aqui: o botão já vem desabilitado com cinco badges, mas duas abas
 * abertas contam quatro cada uma. O banner explica o que fazer (tirar um).
 */
export async function porBadgeNaVitrine(inventarioId: number) {
  const session = await requirePlayer();

  const parsed = idSchema.safeParse(inventarioId);
  if (!parsed.success) redirect("/perfil/inventario?erro=dados-invalidos");

  const erro = await porNaVitrine(session.player.id, parsed.data);
  // Os slugs vão ESCRITOS, um por linha, e não interpolados: o teste de
  // cobertura de src/lib/mensagens.ts varre o FONTE atrás do par erro=… na query
  // string, e uma interpolação faria a varredura não achar nenhum deles.
  if (erro === "vitrine-cheia") redirect("/perfil/inventario?erro=vitrine-cheia");
  if (erro) redirect("/perfil/inventario?erro=item-nao-e-seu");

  revalidarVitrine(session.player.slug);
  redirect("/perfil/inventario?ok=item-na-vitrine");
}

/**
 * Tira o badge da vitrine. Continua no inventário.
 *
 * Sem caminho de erro, pela mesma razão de `desequiparSlot`.
 */
export async function tirarBadgeDaVitrine(inventarioId: number) {
  const session = await requirePlayer();

  const parsed = idSchema.safeParse(inventarioId);
  if (!parsed.success) redirect("/perfil/inventario?erro=dados-invalidos");

  await tirarDaVitrine(session.player.id, parsed.data);

  revalidarVitrine(session.player.slug);
  redirect("/perfil/inventario?ok=item-fora-da-vitrine");
}

/**
 * Escolhe o badge que anda junto do nome nas listas.
 *
 * Revalida mais que as outras: o destaque sai do perfil e circula pelo app —
 * ranking, artilharia e a lista de futs desenham nome de gente, e todas passam a
 * mostrar (ou deixar de mostrar) a figura escolhida.
 *
 * Ele não é mais o ÚNICO a sair daqui: a cor do slot `cor_do_nome` faz o mesmo
 * caminho desde que o `lerCosmeticosDoNome` existe (ver src/lib/loja.ts). E
 * mesmo assim `equiparItem`/`desequiparSlot` não repetem estas duas linhas, o
 * que é de propósito: toda tela que pinta o nome é dinâmica — `/rankings`,
 * `/grupo/[slug]` e `/jogador/[slug]` são `force-dynamic`, `/fut/[id]` e
 * `/perfil` leem o cookie da sessão, e `/artilharia` é só um `permanentRedirect`
 * para a aba. Não há cache de rota para invalidar. Estas duas ficam porque são
 * baratas e porque o dia em que uma dessas telas deixar de ser dinâmica é o dia
 * em que faltariam — mas quem for atrás da assimetria entre as actions para aqui.
 */
export async function destacarBadge(inventarioId: number) {
  const session = await requirePlayer();

  const parsed = idSchema.safeParse(inventarioId);
  if (!parsed.success) redirect("/perfil/inventario?erro=dados-invalidos");

  const erro = await destacar(session.player.id, parsed.data);
  if (erro) redirect("/perfil/inventario?erro=item-nao-e-seu");

  revalidarVitrine(session.player.slug);
  revalidatePath("/rankings");
  revalidatePath("/artilharia");
  redirect("/perfil/inventario?ok=destaque-definido");
}
