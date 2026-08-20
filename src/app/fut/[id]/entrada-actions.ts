"use server";

// Os três caminhos de entrada num fut: convite, pedido e link.
//
// Substituem a exceção que deixava quem organiza um fut avulso marcar presença
// de qualquer jogador ativo da plataforma. O princípio, escrito por extenso em
// src/lib/fut-entrada.ts: **ninguém entra numa lista por decisão de outra
// pessoa** — e cada caminho tem um decisor claro.
//
// Server Action é endpoint HTTP público e não passa pelo proxy, então cada
// action reafirma tudo: sessão, estado do fut, vínculo e escopo. Nenhum id de
// convite ou de pedido é usado sem `matchDayId` no `where` — a mesma trava que
// as actions de grupo já aplicam, e pelo mesmo motivo: o id vem do cliente.

import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { matchDayInviteLinks, matchDayInvitations, matchDayJoinRequests, matchDays } from "@/db/schema";
import { agendarConvitesDeAgenda } from "@/lib/agenda-convite";
import { comoEntraNoFut, podeConvidarParaFut, futAceitaEntrada } from "@/lib/fut-entrada";
import {
  condicaoLinkVivoDoFut,
  estaNaLista,
  estaNoCirculoDoFut,
  fecharConvitePendente,
  fecharPedidoDeFut,
  gerarLinkDoFut,
  jaJogaramJuntos,
  temContaAtiva,
} from "@/lib/fut-entrada-db";
import { ehElegivel } from "@/lib/elegiveis";
import { formatDate } from "@/lib/format";
import { notificar } from "@/lib/notifications";
import { entrarNaLista } from "@/lib/presenca";
import { agendarDespachoDePush } from "@/lib/push-envio";
import { requireFutAdmin } from "@/lib/require-fut-admin";
import { requirePlayer } from "@/lib/require-player";
import { revalidateMatchDay } from "./revalidate";
import { sql } from "drizzle-orm";
import { z } from "zod";

/** O fut como as regras o enxergam, lido do banco — nunca do cliente. */
async function carregarFut(matchDayId: number) {
  const [fut] = await db.select().from(matchDays).where(eq(matchDays.id, matchDayId));
  return fut;
}

// ---------------------------------------------------------------------------
// Convite: quem já jogou com você chama, e quem decide é você
// ---------------------------------------------------------------------------

export async function convidarParaOFut(matchDayId: number, playerId: number) {
  const session = await requirePlayer();
  if (!Number.isInteger(matchDayId) || !Number.isInteger(playerId)) redirect("/futs");
  if (playerId === session.player.id) redirect(`/fut/${matchDayId}?erro=dados-invalidos`);

  const fut = await carregarFut(matchDayId);
  if (!fut) redirect("/futs");

  // `ehOrganizador` sai de `podeGerenciarFut` por dentro do guard; aqui a
  // pergunta é mais barata e não pode redirecionar, então é resolvida à mão.
  const ehOrganizador =
    session.isPlatformAdmin ||
    (fut.createdByPlayerId !== null && fut.createdByPlayerId === session.player.id);

  const ator = { playerId: session.player.id, isPlatformAdmin: session.isPlatformAdmin };
  const jaJogouComOAlvo = await jaJogaramJuntos(session.player.id, playerId);
  if (!podeConvidarParaFut(ator, fut, { ehOrganizador, jaJogouComOAlvo })) {
    redirect(`/fut/${matchDayId}?erro=sem-vinculo-para-convidar`);
  }

  // Convite nominal só alcança quem consegue responder. Quem não tem conta
  // entra pelo caminho de sempre — o organizador cadastra e marca (é o ramo
  // que a exceção de podeDefinirPresencaPor preservou).
  if (!(await temContaAtiva(playerId))) {
    redirect(`/fut/${matchDayId}?erro=convidado-sem-conta`);
  }
  if (await estaNaLista(matchDayId, playerId)) {
    redirect(`/fut/${matchDayId}?erro=ja-esta-na-lista`);
  }

  await db.transaction(async (tx) => {
    const [convite] = await tx
      .insert(matchDayInvitations)
      .values({ matchDayId, playerId, invitedByPlayerId: session.player.id })
      // O índice parcial já garante um pendente por pessoa; convidar de novo é
      // no-op silencioso, e não erro na cara de quem chamou.
      .onConflictDoNothing()
      .returning();
    if (!convite) return;

    await notificar(tx, [
      {
        playerId,
        type: "fut_convite",
        title: "Te chamaram para um fut",
        body: `${session.player.name} chamou você para o fut de ${formatDate(fut.date)}, em ${fut.location}.`,
        href: "/futs",
        dedupeKey: `fut:${matchDayId}:convite:${convite.id}`,
      },
    ]);
  });

  agendarDespachoDePush(true);
  revalidateMatchDay(matchDayId);
  redirect(`/fut/${matchDayId}?ok=convite-enviado`);
}

/**
 * Aceitar ou recusar um convite.
 *
 * O `playerId = sessão` no `where` é a trava: `invitationId` vem do cliente, e
 * sem ele daria para aceitar o convite de outra pessoa — entrando num fut sem
 * nunca ter sido chamado. Mesma forma de `responderConvite` dos grupos.
 */
export async function responderConviteDeFut(
  matchDayId: number,
  invitationId: number,
  aceitar: boolean,
) {
  const session = await requirePlayer();
  if (!Number.isInteger(matchDayId) || !Number.isInteger(invitationId)) redirect("/futs");

  const fut = await carregarFut(matchDayId);
  if (!fut) redirect("/futs");
  if (!futAceitaEntrada(fut)) redirect("/futs?erro=fut-fechado");

  let entrou = false;
  const respondeu = await db.transaction(async (tx) => {
    const [convite] = await tx
      .update(matchDayInvitations)
      .set({ status: aceitar ? "accepted" : "declined", respondedAt: new Date() })
      .where(
        and(
          eq(matchDayInvitations.id, invitationId),
          eq(matchDayInvitations.matchDayId, matchDayId),
          eq(matchDayInvitations.playerId, session.player.id),
          eq(matchDayInvitations.status, "pending"),
        ),
      )
      .returning();
    if (!convite) return false;

    if (aceitar) {
      // Pela lista, e não por insert cru: é `entrarNaLista` que conhece o
      // limite de vagas e manda para a espera quando o fut está cheio.
      const entrada = await entrarNaLista(tx, matchDayId, session.player.id);
      entrou = entrada.para === "in" && entrada.de !== "in";
      await fecharPedidoDeFut(tx, matchDayId, session.player.id);
    }
    return true;
  });

  if (!respondeu) redirect("/futs?erro=convite-invalido");
  if (entrou) agendarConvitesDeAgenda(matchDayId, [session.player.id]);
  revalidateMatchDay(matchDayId);
  redirect(aceitar ? `/fut/${matchDayId}?ok=fut-entrou` : "/futs?ok=convite-recusado");
}

// ---------------------------------------------------------------------------
// Pedido: você acha o fut, e quem decide é quem organiza
// ---------------------------------------------------------------------------

export async function pedirParaEntrarNoFut(matchDayId: number) {
  const session = await requirePlayer();
  if (!Number.isInteger(matchDayId)) redirect("/futs");

  const fut = await carregarFut(matchDayId);
  if (!fut) redirect("/futs");

  const destino = comoEntraNoFut(fut, {
    jaEstaNaLista: await estaNaLista(matchDayId, session.player.id),
    elegivel: await ehElegivel(fut, session.player.id),
    noCirculo: await estaNoCirculoDoFut(fut, session.player.id),
  });
  if (destino !== "pede-entrada") redirect(`/fut/${matchDayId}?erro=fut-entrada-fechada`);

  await db.transaction(async (tx) => {
    const [pedido] = await tx
      .insert(matchDayJoinRequests)
      .values({ matchDayId, playerId: session.player.id })
      .onConflictDoNothing()
      .returning();
    // Sem `pedido` não houve inserção — já havia um pendente, e quem organiza
    // já foi avisado na primeira vez. A chave sai do id do PEDIDO, e não do
    // jogador, pelo mesmo motivo do `pedirEntrada` de grupo: o índice é parcial
    // em `pending`, então pedir de novo depois de uma recusa cria linha nova, e
    // uma chave presa ao jogador faria o segundo aviso morrer no dedupe.
    if (!pedido || fut.createdByPlayerId === null) return;

    await notificar(tx, [
      {
        playerId: fut.createdByPlayerId,
        type: "fut_pedido",
        title: `${session.player.name} quer entrar no seu fut`,
        body: `Fut de ${formatDate(fut.date)}, em ${fut.location}.`,
        href: `/fut/${matchDayId}/gerenciar`,
        dedupeKey: `fut:${matchDayId}:pedido:${pedido.id}`,
      },
    ]);
  });

  agendarDespachoDePush(true);
  revalidateMatchDay(matchDayId);
  redirect(`/fut/${matchDayId}?ok=fut-pedido-enviado`);
}

export async function cancelarPedidoDeFut(matchDayId: number) {
  const session = await requirePlayer();
  if (!Number.isInteger(matchDayId)) redirect("/futs");

  await db
    .delete(matchDayJoinRequests)
    .where(
      and(
        eq(matchDayJoinRequests.matchDayId, matchDayId),
        // O playerId da sessão é o que impede cancelar o pedido de outra pessoa.
        eq(matchDayJoinRequests.playerId, session.player.id),
        eq(matchDayJoinRequests.status, "pending"),
      ),
    );

  revalidateMatchDay(matchDayId);
  redirect(`/fut/${matchDayId}?ok=pedido-cancelado`);
}

/** Aprovar ou recusar um pedido. Só quem gerencia o fut — daí o guard. */
export async function decidirPedidoDeFut(
  matchDayId: number,
  requestId: number,
  aprovar: boolean,
) {
  const { session, matchDay } = await requireFutAdmin(matchDayId);
  if (!Number.isInteger(requestId)) redirect(`/fut/${matchDayId}/gerenciar?erro=dados-invalidos`);
  if (aprovar && !futAceitaEntrada(matchDay)) {
    redirect(`/fut/${matchDayId}/gerenciar?erro=fut-entrada-fechada`);
  }

  let entrou: number | null = null;
  await db.transaction(async (tx) => {
    const [pedido] = await tx
      .update(matchDayJoinRequests)
      .set({
        status: aprovar ? "approved" : "rejected",
        decidedAt: new Date(),
        decidedByPlayerId: session.player.id,
      })
      .where(
        and(
          eq(matchDayJoinRequests.id, requestId),
          // Escopo pelo fut: `requestId` vem do cliente, e sem isto daria para
          // aprovar o pedido pendente de um fut alheio.
          eq(matchDayJoinRequests.matchDayId, matchDayId),
          eq(matchDayJoinRequests.status, "pending"),
        ),
      )
      .returning();
    if (!pedido) return;

    if (aprovar) {
      const entrada = await entrarNaLista(tx, matchDayId, pedido.playerId);
      if (entrada.para === "in" && entrada.de !== "in") entrou = pedido.playerId;
      await fecharConvitePendente(tx, matchDayId, pedido.playerId);
    }

    await notificar(tx, [
      {
        playerId: pedido.playerId,
        type: "fut_pedido_resolvido",
        title: aprovar ? "Você entrou no fut" : "Seu pedido não foi aceito",
        body: `Fut de ${formatDate(matchDay.date)}, em ${matchDay.location}.`,
        href: aprovar ? `/fut/${matchDayId}` : undefined,
        dedupeKey: `fut:${matchDayId}:pedido-resolvido:${pedido.id}`,
      },
    ]);
  });

  agendarDespachoDePush(true);
  if (entrou !== null) agendarConvitesDeAgenda(matchDayId, [entrou]);
  revalidateMatchDay(matchDayId);
  redirect(`/fut/${matchDayId}/gerenciar?ok=${aprovar ? "pedido-aprovado" : "pedido-recusado"}`);
}

// ---------------------------------------------------------------------------
// Link: quem organiza manda, quem abre entra
// ---------------------------------------------------------------------------

const maxUsesSchema = z.union([z.literal(""), z.coerce.number().int().min(1).max(60)]);

export async function gerarLinkDoFutAction(matchDayId: number, formData: FormData) {
  const { session, matchDay } = await requireFutAdmin(matchDayId);
  if (!futAceitaEntrada(matchDay)) {
    redirect(`/fut/${matchDayId}/gerenciar?erro=fut-entrada-fechada`);
  }

  const parsed = maxUsesSchema.safeParse(formData.get("maxUses") ?? "");
  if (!parsed.success) redirect(`/fut/${matchDayId}/gerenciar?erro=dados-invalidos`);

  await db.transaction((tx) =>
    gerarLinkDoFut(tx, matchDayId, session.player.id, parsed.data === "" ? null : parsed.data),
  );

  revalidateMatchDay(matchDayId);
  redirect(`/fut/${matchDayId}/gerenciar?ok=link-gerado`);
}

export async function revogarLinkDoFutAction(matchDayId: number, linkId: number) {
  await requireFutAdmin(matchDayId);
  if (!Number.isInteger(linkId)) redirect(`/fut/${matchDayId}/gerenciar?erro=dados-invalidos`);

  await db
    .update(matchDayInviteLinks)
    .set({ revokedAt: new Date() })
    // Escopo pelo fut: `linkId` vem do cliente, e sem o filtro o link de outro
    // fut seria revogado daqui.
    .where(
      and(eq(matchDayInviteLinks.id, linkId), eq(matchDayInviteLinks.matchDayId, matchDayId)),
    );

  revalidateMatchDay(matchDayId);
  redirect(`/fut/${matchDayId}/gerenciar?ok=link-revogado`);
}

/**
 * Resgata o link do fut.
 *
 * Exige sessão e **nunca cria conta** — a mesma linha que separa o link de
 * grupo do convite de plataforma. Se um dia isto cadastrar, o link que corre
 * solto no WhatsApp vira fábrica de contas.
 *
 * O `for update` na linha do link é o que impede dois cliques simultâneos
 * furarem o `maxUses`.
 */
export async function resgatarLinkDoFut(token: string) {
  const session = await requirePlayer();
  const parsed = z.string().min(1).max(100).safeParse(token);
  if (!parsed.success) redirect("/futs?erro=link-invalido");

  const resultado = await db.transaction(async (tx) => {
    const [link] = await tx
      .select()
      .from(matchDayInviteLinks)
      .where(
        and(
          eq(matchDayInviteLinks.token, parsed.data),
          condicaoLinkVivoDoFut(sql`now()`),
        ),
      )
      .for("update");
    if (!link) return { estado: "invalido" as const };

    const [fut] = await tx.select().from(matchDays).where(eq(matchDays.id, link.matchDayId));
    // O estado do fut é revalidado no resgate, e não só na geração: o link vive
    // sete dias e o sorteio acontece no meio deles.
    if (!fut || !futAceitaEntrada(fut)) {
      return { estado: "fechado" as const, matchDayId: link.matchDayId };
    }

    const entrada = await entrarNaLista(tx, link.matchDayId, session.player.id);
    const novo = entrada.de === null;
    // O uso só é consumido quando alguém de fato entrou pela primeira vez.
    // Reabrir o próprio link — o que todo mundo faz ao rolar a conversa — não
    // pode gastar as vagas de um link com teto.
    if (novo) {
      await tx
        .update(matchDayInviteLinks)
        .set({ usesCount: link.usesCount + 1 })
        .where(eq(matchDayInviteLinks.id, link.id));
      await fecharPedidoDeFut(tx, link.matchDayId, session.player.id);
      await fecharConvitePendente(tx, link.matchDayId, session.player.id);
    }
    return {
      estado: "ok" as const,
      matchDayId: link.matchDayId,
      entrouEmVaga: entrada.para === "in" && entrada.de !== "in",
    };
  });

  if (resultado.estado === "invalido") redirect("/futs?erro=link-invalido");
  if (resultado.estado === "fechado") {
    redirect(`/fut/${resultado.matchDayId}?erro=fut-entrada-fechada`);
  }
  if (resultado.entrouEmVaga) agendarConvitesDeAgenda(resultado.matchDayId, [session.player.id]);
  revalidateMatchDay(resultado.matchDayId);
  redirect(`/fut/${resultado.matchDayId}?ok=fut-entrou`);
}
