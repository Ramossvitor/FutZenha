"use server";

import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { groupInvitations, groupJoinRequests, groupMembers } from "@/db/schema";
import { podeEntrarNoGrupo, podeSairDoGrupo } from "@/lib/grupos-permissions";
import { fecharPedidoPendente, getGrupo } from "@/lib/grupos";
import { notificar } from "@/lib/notifications";
import { requireGrupoMembro, requireGrupoVisivel } from "@/lib/require-grupo";
import { revalidateGrupo } from "./revalidate";
import { requirePlayer } from "@/lib/require-player";

/** O admin do grupo, para avisar de pedido de entrada. */
async function adminDoGrupo(groupId: number): Promise<number | undefined> {
  const [row] = await db
    .select({ playerId: groupMembers.playerId })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.role, "admin")));
  return row?.playerId;
}

/**
 * Entrada livre: só em grupo público com `join_policy = 'open'`.
 *
 * A decisão vem inteira de `podeEntrarNoGrupo`, que testa a visibilidade antes
 * da política — um grupo que era público e virou privado guarda o `'open'` de
 * herança, e sem essa ordem esta action seria a porta dos fundos dele.
 */
export async function entrarNoGrupo(groupId: number) {
  const { session, grupo, papel } = await requireGrupoVisivel(groupId);
  if (podeEntrarNoGrupo(grupo, papel) !== "entra-direto") {
    redirect(`/grupo/${grupo.slug}?erro=entrada-fechada`);
  }

  await db.transaction(async (tx) => {
    await tx
      .insert(groupMembers)
      .values({ groupId, playerId: session.player.id, role: "member" })
      .onConflictDoNothing();
    await fecharPedidoPendente(tx, groupId, session.player.id);
  });

  revalidateGrupo(grupo.slug);
  redirect(`/grupo/${grupo.slug}?ok=entrou`);
}

/** Pedido de entrada: só em grupo público sob aprovação. */
export async function pedirEntrada(groupId: number) {
  const { session, grupo, papel } = await requireGrupoVisivel(groupId);
  if (podeEntrarNoGrupo(grupo, papel) !== "pede-entrada") {
    redirect(`/grupo/${grupo.slug}?erro=entrada-fechada`);
  }

  const admin = await adminDoGrupo(groupId);
  await db.transaction(async (tx) => {
    // O índice parcial garante um pendente por pessoa; reenviar é no-op.
    const [pedido] = await tx
      .insert(groupJoinRequests)
      .values({ groupId, playerId: session.player.id })
      .onConflictDoNothing()
      .returning();

    // A chave sai do id do PEDIDO, não do jogador. `notificar` deduplica em
    // (player_id, dedupe_key), e o índice de group_join_requests é parcial em
    // `status = 'pending'` justamente para deixar pedir de novo depois de uma
    // recusa. Com a chave presa ao jogador, o segundo pedido criava a linha na
    // fila mas a notificação morria no onConflictDoNothing: o admin nunca ficava
    // sabendo, e o pedido esperava para sempre. É o mesmo formato que
    // aprovarPedido/recusarPedido já usam.
    //
    // Sem `pedido` não houve inserção — já havia um pendente, e o admin já foi
    // avisado na primeira vez.
    if (admin && pedido) {
      await notificar(tx, [
        {
          playerId: admin,
          type: "group_join_request",
          title: `${session.player.name} quer entrar em ${grupo.name}`,
          href: `/grupo/${grupo.slug}/gerenciar`,
          dedupeKey: `grupo:${groupId}:pedido:${pedido.id}`,
        },
      ]);
    }
  });

  revalidateGrupo(grupo.slug);
  redirect(`/grupo/${grupo.slug}?ok=pedido-enviado`);
}

export async function cancelarPedido(groupId: number) {
  const session = await requirePlayer();
  if (!Number.isInteger(groupId)) redirect("/grupos");

  // Sem guard de grupo, de propósito: quem cancela o próprio pedido não precisa
  // enxergar o grupo (ele pode ter virado privado no meio do caminho). Mas a
  // tradução id→slug só acontece DEPOIS da prova de que o pedido existia — quem
  // pediu entrada viu o grupo um dia. Traduzir para qualquer id chutado
  // devolveria no redirect o endereço (derivado do nome) de grupo privado a
  // quem nunca o viu: o oráculo de enumeração que a URL por slug veio fechar.
  const [cancelado] = await db
    .delete(groupJoinRequests)
    .where(
      and(
        eq(groupJoinRequests.groupId, groupId),
        // O playerId da sessão no `where` é o que impede cancelar o pedido de
        // outra pessoa.
        eq(groupJoinRequests.playerId, session.player.id),
        eq(groupJoinRequests.status, "pending"),
      ),
    )
    .returning({ groupId: groupJoinRequests.groupId });
  if (!cancelado) redirect("/grupos");

  // O grupo é buscado só para saber o endereço de volta — sem ele não há para
  // onde redirecionar nem o que revalidar.
  const grupo = await getGrupo(groupId);
  if (!grupo) redirect("/grupos");

  revalidateGrupo(grupo.slug);
  redirect(`/grupo/${grupo.slug}?ok=pedido-cancelado`);
}

/**
 * Aceitar ou recusar um convite nominal.
 *
 * O `playerId = sessão` no `where` é a trava: sem ele, `invitationId` é um
 * número que vem do cliente e daria para aceitar o convite de outra pessoa —
 * entrando num grupo privado sem nunca ter sido convidado.
 */
export async function responderConvite(groupId: number, invitationId: number, aceitar: boolean) {
  const session = await requirePlayer();
  if (!Number.isInteger(groupId) || !Number.isInteger(invitationId)) redirect("/grupos");

  const entrou = await db.transaction(async (tx) => {
    const [convite] = await tx
      .update(groupInvitations)
      .set({ status: aceitar ? "accepted" : "declined", respondedAt: new Date() })
      .where(
        and(
          eq(groupInvitations.id, invitationId),
          eq(groupInvitations.groupId, groupId),
          eq(groupInvitations.playerId, session.player.id),
          eq(groupInvitations.status, "pending"),
        ),
      )
      .returning();
    if (!convite) return false;

    if (aceitar) {
      // onConflictDoNothing: se a pessoa entrou pelo link enquanto o convite
      // estava aberto, aceitar não pode rebaixá-la a "member".
      await tx
        .insert(groupMembers)
        .values({ groupId, playerId: session.player.id, role: "member" })
        .onConflictDoNothing();
      await fecharPedidoPendente(tx, groupId, session.player.id);
    }
    return true;
  });

  // Id de grupo inexistente morre aqui também (o `groupId` do `where` não casa
  // convite nenhum), com a MESMA resposta de convite inválido: um `getGrupo`
  // antes da validação responderia "esse id existe?" para qualquer chute — o
  // meio-vazamento 403-vs-404 que src/lib/require-grupo.ts documenta.
  if (!entrou) redirect("/grupos?erro=convite-invalido");

  // Como no `cancelarPedido`: sem guard (responder convite de grupo privado é
  // justamente o caso normal), e o grupo — lido só para saber o endereço de
  // volta — só é buscado depois de o convite valer.
  const grupo = await getGrupo(groupId);
  if (!grupo) redirect("/grupos");

  revalidateGrupo(grupo.slug);
  if (aceitar) redirect(`/grupo/${grupo.slug}?ok=entrou`);
  redirect("/grupos?ok=convite-recusado");
}

/**
 * Sair do grupo.
 *
 * O admin não sai sem transferir: o grupo ficaria com futs marcados que
 * ninguém encerra e uma fila de pedidos que ninguém decide.
 */
export async function sairDoGrupo(groupId: number) {
  const { session, grupo, papel } = await requireGrupoMembro(groupId);
  if (!podeSairDoGrupo(papel)) redirect(`/grupo/${grupo.slug}?erro=admin-precisa-transferir`);

  await db
    .delete(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.playerId, session.player.id)));

  revalidateGrupo(grupo.slug);
  redirect("/grupos?ok=saiu");
}
