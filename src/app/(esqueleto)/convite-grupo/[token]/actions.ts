"use server";

import { redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { revalidateGrupo } from "@/app/(esqueleto)/grupo/[slug]/revalidate";
import { db } from "@/db";
import { groupInviteLinks, groupMembers } from "@/db/schema";
import { condicaoLinkVivo } from "@/lib/grupos-link";
import { fecharPedidoPendente, getGrupo } from "@/lib/grupos";
import { requirePlayer } from "@/lib/require-player";

/**
 * Resgata o link do grupo.
 *
 * Exige sessão e **nunca cria conta** — esta é a diferença que separa o link de
 * grupo do convite de plataforma (src/lib/convites.ts). O link corre solto num
 * grupo de WhatsApp; se ele também cadastrasse, o token sozinho viraria uma
 * fábrica de contas na plataforma inteira. Quem não tem conta cai no login pelo
 * `?next=` que o proxy monta, cria a conta pelo caminho normal e volta.
 *
 * O `for update` na linha do link é o que impede dois cliques simultâneos
 * furarem o `maxUses`: sem ele, as duas transações leem `usesCount = 4` de um
 * teto de 5 e as duas gravam 5.
 */
export async function resgatarLinkDoGrupo(token: string) {
  const session = await requirePlayer();

  // O token chega pelo `.bind`, ou seja, do corpo do POST — Server Action é
  // endpoint público. O teto é o mesmo `.max(100)` que o claimInvite já aplica:
  // o valor real tem 43 caracteres (32 bytes em base64url), e nada legítimo
  // chega perto. Sem ele, um corpo de megabytes ia inteiro para o índice.
  const parsed = z.string().min(1).max(100).safeParse(token);
  if (!parsed.success) redirect("/grupos?erro=link-invalido");

  const resultado = await db.transaction(async (tx) => {
    const [link] = await tx
      .select()
      .from(groupInviteLinks)
      .where(and(eq(groupInviteLinks.token, parsed.data), condicaoLinkVivo(sql`now()`)))
      .for("update");
    if (!link) return { estado: "invalido" as const };

    const [entrou] = await tx
      .insert(groupMembers)
      .values({ groupId: link.groupId, playerId: session.player.id, role: "member" })
      // Quem já é do grupo reabrindo o link não pode ser rebaixado a "member",
      // e o `returning` vazio é o que diz que nada entrou.
      .onConflictDoNothing()
      .returning();

    // O uso só é consumido quando alguém de fato entrou. Reabrir o próprio link
    // — o que todo mundo faz ao rolar a conversa do WhatsApp — não pode gastar
    // as vagas de um link com teto.
    if (entrou) {
      await tx
        .update(groupInviteLinks)
        .set({ usesCount: link.usesCount + 1 })
        .where(eq(groupInviteLinks.id, link.id));
      await fecharPedidoPendente(tx, link.groupId, session.player.id);
    }

    return { estado: "ok" as const, groupId: link.groupId };
  });

  if (resultado.estado === "invalido") redirect("/grupos?erro=link-invalido");

  // O link carrega o id; a URL de destino é o slug. Sem esta tradução o redirect
  // levaria para um endereço que não existe mais, e o revalidate não invalidaria
  // nada — calado, porque `revalidatePath` de caminho inexistente não é erro.
  const grupo = await getGrupo(resultado.groupId);
  if (!grupo) redirect("/grupos?erro=link-invalido");

  revalidateGrupo(grupo.slug);
  redirect(`/grupo/${grupo.slug}?ok=entrou`);
}
