"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  groupInvitations,
  groupInviteLinks,
  groupJoinRequests,
  groupMembers,
  groups,
  users,
} from "@/db/schema";
import { parseGrupoForm } from "@/lib/grupos-form";
import { podePromover, podeRemoverMembro } from "@/lib/grupos-permissions";
import { gerarLink, papelNoGrupo } from "@/lib/grupos";
import { notificar } from "@/lib/notifications";
import { requireGrupoAdmin, requireGrupoOrganizador } from "@/lib/require-grupo";
import { revalidateGrupo } from "../revalidate";

function erro(groupId: number, slug: string): never {
  redirect(`/grupo/${groupId}/gerenciar?erro=${slug}`);
}

function ok(groupId: number, slug: string): never {
  redirect(`/grupo/${groupId}/gerenciar?ok=${slug}`);
}

// ---------------------------------------------------------------------------
// Dados do grupo
// ---------------------------------------------------------------------------

/**
 * Nome, descrição, visibilidade e política de entrada.
 *
 * Fechar o grupo (público → privado) rejeita os pedidos pendentes na mesma
 * transação. Grupo privado não tem fila de portaria, e deixar os pedidos vivos
 * seria guardar aprovações esperando para acontecer: bastaria alguém clicar
 * "aprovar" na tela e o grupo recém-fechado ganharia um membro que entrou pela
 * porta que acabou de ser trancada.
 */
export async function atualizarGrupo(groupId: number, formData: FormData) {
  await requireGrupoAdmin(groupId);

  const parsed = parseGrupoForm(formData);
  if (!parsed.success) erro(groupId, "dados-invalidos");

  await db.transaction(async (tx) => {
    await tx.update(groups).set(parsed.data).where(eq(groups.id, groupId));
    if (parsed.data.visibility === "private") {
      await tx
        .update(groupJoinRequests)
        .set({ status: "rejected", decidedAt: new Date() })
        .where(
          and(eq(groupJoinRequests.groupId, groupId), eq(groupJoinRequests.status, "pending")),
        );
    }
  });

  revalidateGrupo(groupId);
  ok(groupId, "grupo-atualizado");
}

/**
 * Excluir o grupo.
 *
 * Membros, convites, links e pedidos caem em cascata. As peladas NÃO: a FK é
 * `set null` e elas viram avulsas, preservando gols, V/E/D, avaliações e
 * skill_history que alimentam o ranking global (ver src/db/schema.ts).
 *
 * A confirmação por nome digitado espelha o `motivoExclusaoSchema` do painel da
 * plataforma: é a única ação daqui que não tem desfazer.
 */
export async function excluirGrupo(groupId: number, formData: FormData) {
  const { grupo } = await requireGrupoAdmin(groupId);

  const confirmacao = formData.get("confirmacao");
  if (typeof confirmacao !== "string" || confirmacao.trim() !== grupo.name) {
    erro(groupId, "confirmacao-nao-confere");
  }

  await db.delete(groups).where(eq(groups.id, groupId));

  revalidatePath("/grupos");
  revalidatePath("/peladas");
  revalidatePath("/rankings");
  redirect("/grupos?ok=grupo-excluido");
}

// ---------------------------------------------------------------------------
// Papéis
// ---------------------------------------------------------------------------

const papelSchema = z.enum(["organizer", "member"]);

/** Promover a organizador ou rebaixar a membro. Nunca toca no papel `admin`. */
export async function definirPapel(groupId: number, playerId: number, novoPapel: string) {
  const { session, papel: papelDoAtor } = await requireGrupoAdmin(groupId);
  if (!Number.isInteger(playerId)) erro(groupId, "dados-invalidos");

  const parsed = papelSchema.safeParse(novoPapel);
  if (!parsed.success) erro(groupId, "dados-invalidos");

  const papelAtual = await papelNoGrupo(groupId, playerId);
  const ator = { playerId: session.player.id, isPlatformAdmin: session.isPlatformAdmin };
  const alvo = { papelAtual, ehOAtor: playerId === session.player.id };
  if (!podePromover(ator, papelDoAtor, alvo)) erro(groupId, "sem-permissao");

  const [grupo] = await db.select({ name: groups.name }).from(groups).where(eq(groups.id, groupId));
  const agora = new Date();

  await db.transaction(async (tx) => {
    await tx
      .update(groupMembers)
      .set({ role: parsed.data })
      // O escopo por groupId não é opcional: `playerId` vem do cliente, e sem
      // ele um id de membro de outro grupo seria promovido por esta chamada.
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.playerId, playerId)));

    await notificar(tx, [
      {
        playerId,
        type: "group_role_changed",
        title:
          parsed.data === "organizer"
            ? `Você agora organiza ${grupo.name}`
            : `Seu papel em ${grupo.name} mudou`,
        body:
          parsed.data === "organizer"
            ? "Você já pode marcar peladas do grupo e convidar gente."
            : "Você voltou a ser membro do grupo.",
        href: `/grupo/${groupId}`,
        // A chave marca o EVENTO, não o estado. Carregar só o papel de destino
        // cobre um ciclo e para: promover → rebaixar → promover reencontraria
        // `...:organizer` no índice (player_id, dedupe_key) e o
        // onConflictDoNothing engoliria a terceira mudança em silêncio. O
        // instante da mutação é o que torna cada troca única.
        dedupeKey: `grupo:${groupId}:papel:${playerId}:${parsed.data}:${agora.toISOString()}`,
      },
    ]);
  });

  revalidateGrupo(groupId);
  ok(groupId, "papel-alterado");
}

/**
 * Passar a administração do grupo para outro membro.
 *
 * A ordem — rebaixar o admin atual e só então promover o alvo — é obrigatória:
 * `group_members_admin_unico_idx` é um índice único parcial e não é deferrable,
 * então promover primeiro estouraria a constraint no meio da transação.
 *
 * O `for update` nas duas linhas serializa duas transferências simultâneas; sem
 * ele, as duas leriam "sou o admin" e uma sobrescreveria a outra.
 */
export async function transferirAdministracao(groupId: number, playerId: number) {
  const { session, grupo } = await requireGrupoAdmin(groupId);
  if (!Number.isInteger(playerId)) erro(groupId, "dados-invalidos");
  if (playerId === session.player.id) erro(groupId, "transferencia-para-si");

  const agora = new Date();

  const resultado = await db.transaction(async (tx) => {
    const linhas = await tx
      .select({ playerId: groupMembers.playerId, role: groupMembers.role })
      .from(groupMembers)
      .where(eq(groupMembers.groupId, groupId))
      .for("update");

    const alvo = linhas.find((l) => l.playerId === playerId);
    if (!alvo) return "alvo-nao-e-membro" as const;
    if (alvo.role === "admin") return "alvo-ja-e-admin" as const;

    // Conta ativa é requisito, não detalhe: `definirPapel` exclui "admin" no
    // schema e `podePromover`/`podeRemoverMembro` recusam alvo "admin", então
    // administração que cai numa conta que não loga não tem como voltar. O grupo
    // ficaria órfão para sempre — o mesmo buraco que `podeSairDoGrupo` fecha do
    // outro lado. `listarMembros` já expõe esse estado como `temConta`.
    const [conta] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.playerId, playerId), eq(users.active, true)));
    if (!conta) return "alvo-sem-conta" as const;

    const adminAtual = linhas.find((l) => l.role === "admin");
    // O admin de fato transfere a própria administração. O admin da plataforma
    // também passa — é o fallback de sempre, e sem ele um grupo já órfão (admin
    // com conta desativada depois de assumir) não teria conserto nenhum.
    const ehOAdmin = adminAtual?.playerId === session.player.id;
    if (!ehOAdmin && !session.isPlatformAdmin) return "nao-e-o-admin" as const;

    // Rebaixar antes de promover, nesta ordem e na mesma transação: o índice
    // parcial `group_members_admin_unico_idx` não é deferrable. Grupo sem admin
    // atual (órfão) pula direto para a promoção.
    if (adminAtual) {
      await tx
        .update(groupMembers)
        .set({ role: "organizer" })
        .where(
          and(eq(groupMembers.groupId, groupId), eq(groupMembers.playerId, adminAtual.playerId)),
        );
    }
    await tx
      .update(groupMembers)
      .set({ role: "admin" })
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.playerId, playerId)));

    await notificar(tx, [
      {
        playerId,
        type: "group_role_changed",
        title: `Você agora administra ${grupo.name}`,
        body: "Papéis, convites, pedidos de entrada e os dados do grupo são seus.",
        href: `/grupo/${groupId}/gerenciar`,
        // Mesma razão de `definirPapel`: a administração pode ir e voltar para a
        // mesma pessoa, e uma chave só de estado silenciaria o segundo aviso.
        dedupeKey: `grupo:${groupId}:papel:${playerId}:admin:${agora.toISOString()}`,
      },
    ]);
    return "ok" as const;
  });

  if (resultado === "alvo-nao-e-membro") erro(groupId, "alvo-nao-e-membro");
  if (resultado === "alvo-ja-e-admin") erro(groupId, "alvo-ja-e-admin");
  if (resultado === "alvo-sem-conta") erro(groupId, "alvo-sem-conta");
  if (resultado === "nao-e-o-admin") erro(groupId, "nao-e-o-admin");

  revalidateGrupo(groupId);
  ok(groupId, "administracao-transferida");
}

export async function removerMembro(groupId: number, playerId: number) {
  const { session, papel: papelDoAtor } = await requireGrupoAdmin(groupId);
  if (!Number.isInteger(playerId)) erro(groupId, "dados-invalidos");

  const papelAtual = await papelNoGrupo(groupId, playerId);
  const ator = { playerId: session.player.id, isPlatformAdmin: session.isPlatformAdmin };
  const alvo = { papelAtual, ehOAtor: playerId === session.player.id };
  if (!podeRemoverMembro(ator, papelDoAtor, alvo)) erro(groupId, "sem-permissao");

  // Remover só a linha de `group_members` não expulsa ninguém de verdade: o link
  // do grupo continua vivo no WhatsApp, e `resgatarLinkDoGrupo` valida apenas
  // token/validade/teto — nunca `podeEntrarNoGrupo`. O removido reabriria a
  // conversa e entraria de novo, inclusive em grupo privado, que é justamente o
  // caminho que `entrarNoGrupo` recusa com "so-convite".
  //
  // Revogar os links ativos é a mesma operação que `gerarLink` já faz ao criar
  // um novo, e não cria armadilha: o admin gera outro quando quiser, e reconvidar
  // quem foi removido por engano continua funcionando normalmente. Uma lista de
  // bloqueio permanente, sem tela de desbloqueio, é que seria irreversível.
  await db.transaction(async (tx) => {
    await tx
      .delete(groupMembers)
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.playerId, playerId)));
    await tx
      .update(groupInviteLinks)
      .set({ revokedAt: new Date() })
      .where(and(eq(groupInviteLinks.groupId, groupId), isNull(groupInviteLinks.revokedAt)));
  });

  revalidateGrupo(groupId);
  ok(groupId, "membro-removido");
}

// ---------------------------------------------------------------------------
// Convites
// ---------------------------------------------------------------------------

const maxUsesSchema = z.union([z.literal(""), z.coerce.number().int().min(1).max(500)]);

/** Gera o link do grupo e revoga o anterior (ver gerarLink em src/lib/grupos.ts). */
export async function gerarLinkDoGrupo(groupId: number, formData: FormData) {
  const { session } = await requireGrupoOrganizador(groupId);

  const parsed = maxUsesSchema.safeParse(formData.get("maxUses") ?? "");
  if (!parsed.success) erro(groupId, "dados-invalidos");
  const maxUses = parsed.data === "" ? null : parsed.data;

  await db.transaction((tx) => gerarLink(tx, groupId, session.player.id, maxUses));

  revalidateGrupo(groupId);
  ok(groupId, "link-gerado");
}

export async function revogarLinkDoGrupo(groupId: number, linkId: number) {
  await requireGrupoOrganizador(groupId);
  if (!Number.isInteger(linkId)) erro(groupId, "dados-invalidos");

  await db
    .update(groupInviteLinks)
    .set({ revokedAt: new Date() })
    // Escopo pelo grupo: `linkId` vem do cliente, e sem o filtro o link de
    // outro grupo — de gente que nem conhece este admin — seria revogado daqui.
    .where(and(eq(groupInviteLinks.id, linkId), eq(groupInviteLinks.groupId, groupId)));

  revalidateGrupo(groupId);
  ok(groupId, "link-revogado");
}

/**
 * Convite nominal para quem já tem conta.
 *
 * Quem não tem conta não entra por aqui: o caminho dele é a pelada
 * (`convidarParaPelada`), que cria o jogador e gera o convite de plataforma. Um
 * convite de grupo para jogador sem conta ficaria pendente para sempre — não há
 * ninguém para aceitá-lo.
 */
export async function convidarJogador(groupId: number, formData: FormData) {
  const { session, grupo } = await requireGrupoOrganizador(groupId);

  const playerId = Number(formData.get("playerId"));
  if (!Number.isInteger(playerId)) erro(groupId, "dados-invalidos");

  const [conta] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.playerId, playerId), eq(users.active, true)));
  if (!conta) erro(groupId, "sem-conta");

  if ((await papelNoGrupo(groupId, playerId)) !== null) erro(groupId, "ja-membro");

  await db.transaction(async (tx) => {
    const [convite] = await tx
      .insert(groupInvitations)
      .values({ groupId, playerId, invitedByPlayerId: session.player.id })
      // O índice parcial já garante um pendente por pessoa; convidar de novo é
      // no-op silencioso, e não erro na cara do organizador.
      .onConflictDoNothing()
      .returning();
    if (!convite) return;

    await notificar(tx, [
      {
        playerId,
        type: "group_invitation",
        title: `Convite para ${grupo.name}`,
        body: `${session.player.name} convidou você para o grupo.`,
        href: "/grupos",
        dedupeKey: `grupo:${groupId}:convite:${convite.id}`,
      },
    ]);
  });

  revalidateGrupo(groupId);
  ok(groupId, "convite-enviado");
}

export async function revogarConvite(groupId: number, invitationId: number) {
  await requireGrupoOrganizador(groupId);
  if (!Number.isInteger(invitationId)) erro(groupId, "dados-invalidos");

  await db
    .update(groupInvitations)
    .set({ status: "revoked", respondedAt: new Date() })
    .where(
      and(
        eq(groupInvitations.id, invitationId),
        eq(groupInvitations.groupId, groupId),
        eq(groupInvitations.status, "pending"),
      ),
    );

  revalidateGrupo(groupId);
  ok(groupId, "convite-revogado");
}

// ---------------------------------------------------------------------------
// Pedidos de entrada
// ---------------------------------------------------------------------------

/** Aprovar entrada. É do admin: quem entra no grupo decide quem joga as peladas
 *  dele e, por tabela, quem aparece no ranking do grupo. */
export async function aprovarPedido(groupId: number, requestId: number) {
  const { session, grupo } = await requireGrupoAdmin(groupId);
  if (!Number.isInteger(requestId)) erro(groupId, "dados-invalidos");

  await db.transaction(async (tx) => {
    const [pedido] = await tx
      .update(groupJoinRequests)
      .set({ status: "approved", decidedAt: new Date(), decidedByPlayerId: session.player.id })
      .where(
        and(
          eq(groupJoinRequests.id, requestId),
          // Escopo pelo grupo, pelo mesmo motivo de sempre: `requestId` vem do
          // cliente, e sem isto daria para aprovar o pedido pendente de um
          // grupo alheio — colocando um estranho lá dentro.
          eq(groupJoinRequests.groupId, groupId),
          eq(groupJoinRequests.status, "pending"),
        ),
      )
      .returning();
    if (!pedido) return;

    await tx
      .insert(groupMembers)
      .values({ groupId, playerId: pedido.playerId, role: "member" })
      .onConflictDoNothing();

    await notificar(tx, [
      {
        playerId: pedido.playerId,
        type: "group_join_request_resolved",
        title: `Você entrou em ${grupo.name}`,
        href: `/grupo/${groupId}`,
        dedupeKey: `grupo:${groupId}:pedido-resolvido:${pedido.id}`,
      },
    ]);
  });

  revalidateGrupo(groupId);
  ok(groupId, "pedido-aprovado");
}

export async function recusarPedido(groupId: number, requestId: number) {
  const { session, grupo } = await requireGrupoAdmin(groupId);
  if (!Number.isInteger(requestId)) erro(groupId, "dados-invalidos");

  await db.transaction(async (tx) => {
    const [pedido] = await tx
      .update(groupJoinRequests)
      .set({ status: "rejected", decidedAt: new Date(), decidedByPlayerId: session.player.id })
      .where(
        and(
          eq(groupJoinRequests.id, requestId),
          eq(groupJoinRequests.groupId, groupId),
          eq(groupJoinRequests.status, "pending"),
        ),
      )
      .returning();
    if (!pedido) return;

    await notificar(tx, [
      {
        playerId: pedido.playerId,
        type: "group_join_request_resolved",
        title: `Seu pedido para ${grupo.name} não foi aceito`,
        dedupeKey: `grupo:${groupId}:pedido-resolvido:${pedido.id}`,
      },
    ]);
  });

  revalidateGrupo(groupId);
  ok(groupId, "pedido-recusado");
}
