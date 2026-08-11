import "server-only";
import { randomBytes } from "node:crypto";
import { cache } from "react";
import { and, asc, count, desc, eq, ilike, isNull, max, sql } from "drizzle-orm";
import { db, type Executor } from "@/db";
import {
  groupInvitations,
  groupInviteLinks,
  groupJoinRequests,
  groupMembers,
  groups,
  matchDays,
  players,
  users,
  type Group,
} from "@/db/schema";
import { condicaoLinkVivo } from "./grupos-link";
import type { Vinculo } from "./grupos-permissions";
import { siteUrl } from "./site-url";

// Mesma validade dos convites de plataforma (src/lib/convites.ts): o link corre
// num grupo de WhatsApp, e uma semana é o que separa "o pessoal ainda está
// entrando" de "isso vazou faz tempo".
const LINK_DURATION_MS = 1000 * 60 * 60 * 24 * 7;

/**
 * O papel do jogador neste grupo. `null` = não é membro.
 *
 * Envolta em `cache()` do React pelo mesmo motivo de `getSession`: a mesma
 * página lê o papel no guard, no cabeçalho e em cada botão, e sem a memoização
 * seriam quatro consultas idênticas por render.
 */
export const papelNoGrupo = cache(
  async (groupId: number, playerId: number): Promise<Vinculo> => {
    const [row] = await db
      .select({ role: groupMembers.role })
      .from(groupMembers)
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.playerId, playerId)));
    return row?.role ?? null;
  },
);

// `cache()` porque generateMetadata e o corpo da página de grupo perguntam o
// mesmo grupo no mesmo render — sem isto eram duas consultas idênticas.
export const getGrupo = cache(async (groupId: number): Promise<Group | undefined> => {
  const [grupo] = await db.select().from(groups).where(eq(groups.id, groupId));
  return grupo;
});

export type MeuGrupo = Group & { papel: NonNullable<Vinculo>; membros: number };

/** Os grupos de que o jogador participa, com o papel dele em cada um. */
export async function listarMeusGrupos(playerId: number): Promise<MeuGrupo[]> {
  return db
    .select({
      id: groups.id,
      name: groups.name,
      description: groups.description,
      visibility: groups.visibility,
      joinPolicy: groups.joinPolicy,
      createdByPlayerId: groups.createdByPlayerId,
      createdAt: groups.createdAt,
      papel: groupMembers.role,
      membros: sql<number>`(
        select count(*)::int from group_members gm where gm.group_id = ${groups.id}
      )`,
    })
    .from(groupMembers)
    .innerJoin(groups, eq(groupMembers.groupId, groups.id))
    .where(eq(groupMembers.playerId, playerId))
    .orderBy(asc(groups.name));
}

export type GrupoDoSeletor = Pick<Group, "id" | "name">;

/**
 * Meus grupos, enxutos, para o seletor do cabeçalho.
 *
 * Separada de `listarMeusGrupos` por causa do custo: aquela carrega descrição,
 * política de entrada e um `count(*)` correlacionado por grupo, e roda em três
 * telas. Esta roda em TODA navegação, dentro do layout — o subselect de
 * contagem seria uma varredura de `group_members` por request para pintar uma
 * lista que só mostra nome.
 */
export async function listarGruposDoSeletor(playerId: number): Promise<GrupoDoSeletor[]> {
  return db
    .select({ id: groups.id, name: groups.name })
    .from(groupMembers)
    .innerJoin(groups, eq(groupMembers.groupId, groups.id))
    .where(eq(groupMembers.playerId, playerId))
    .orderBy(asc(groups.name));
}

/**
 * Grupos públicos, para a aba "descobrir" de /grupos.
 *
 * O filtro por `visibility = 'public'` é a única coisa que separa esta lista de
 * um vazamento: grupo privado não aparece em listagem nenhuma, nem com termo de
 * busca que case o nome exato.
 */
export async function listarGruposPublicos(
  termo?: string,
): Promise<(Group & { membros: number })[]> {
  return db
    .select({
      id: groups.id,
      name: groups.name,
      description: groups.description,
      visibility: groups.visibility,
      joinPolicy: groups.joinPolicy,
      createdByPlayerId: groups.createdByPlayerId,
      createdAt: groups.createdAt,
      membros: sql<number>`(
        select count(*)::int from group_members gm where gm.group_id = ${groups.id}
      )`,
    })
    .from(groups)
    .where(
      and(
        eq(groups.visibility, "public"),
        termo && termo.trim() !== "" ? ilike(groups.name, `%${termo.trim()}%`) : undefined,
      ),
    )
    .orderBy(asc(groups.name))
    .limit(50);
}

export type MembroDoGrupo = {
  playerId: number;
  name: string;
  nickname: string | null;
  papel: NonNullable<Vinculo>;
  temConta: boolean;
};

export async function listarMembros(groupId: number): Promise<MembroDoGrupo[]> {
  const rows = await db
    .select({
      playerId: players.id,
      name: players.name,
      nickname: players.nickname,
      papel: groupMembers.role,
      temConta: sql<boolean>`${users.id} is not null and ${users.active}`,
    })
    .from(groupMembers)
    .innerJoin(players, eq(groupMembers.playerId, players.id))
    .leftJoin(users, eq(users.playerId, players.id))
    .where(eq(groupMembers.groupId, groupId))
    .orderBy(asc(players.name));

  // admin primeiro, depois organizadores, depois membros — a ordem em que a
  // tela de gestão precisa deles.
  const peso = { admin: 0, organizer: 1, member: 2 } as const;
  return rows.sort((a, b) => peso[a.papel] - peso[b.papel] || a.name.localeCompare(b.name));
}

/**
 * Fecha o pedido de entrada pendente de quem acabou de entrar por outro caminho.
 *
 * Os três caminhos de entrada (link, convite nominal, entrada livre) chamam esta
 * função porque nenhum deles passa pela fila: sem ela, quem pediu e entrou por
 * fora continua aparecendo em `pedidosPendentes` para sempre. Aprovar aquele
 * pedido fantasma é no-op silencioso — o `onConflictDoNothing` do insert não faz
 * nada — mas a tela ainda diz "Pedido aprovado".
 *
 * E como `group_join_requests_pendente_idx` é parcial em `status = 'pending'`, a
 * linha esquecida ainda bloquearia um pedido legítimo se a pessoa saísse e
 * quisesse voltar.
 */
export async function fecharPedidoPendente(
  exec: Executor,
  groupId: number,
  playerId: number,
): Promise<void> {
  await exec
    .update(groupJoinRequests)
    .set({ status: "approved", decidedAt: new Date() })
    .where(
      and(
        eq(groupJoinRequests.groupId, groupId),
        eq(groupJoinRequests.playerId, playerId),
        eq(groupJoinRequests.status, "pending"),
      ),
    );
}

/** Convites nominais pendentes para mim — a caixa de entrada de /grupos. */
export async function convitesPendentes(playerId: number) {
  return db
    .select({
      id: groupInvitations.id,
      groupId: groups.id,
      groupName: groups.name,
      groupDescription: groups.description,
      createdAt: groupInvitations.createdAt,
      convidadoPor: players.name,
    })
    .from(groupInvitations)
    .innerJoin(groups, eq(groupInvitations.groupId, groups.id))
    .leftJoin(players, eq(groupInvitations.invitedByPlayerId, players.id))
    .where(and(eq(groupInvitations.playerId, playerId), eq(groupInvitations.status, "pending")))
    .orderBy(desc(groupInvitations.createdAt));
}

/** Convites nominais que este grupo enviou e ainda aguardam resposta. */
export async function convitesEnviados(groupId: number) {
  // O selo de e-mail é do PAR (grupo, jogador), não desta linha. Revogar e
  // reconvidar cria linha nova, e o dedupe do aviso automático olha o histórico
  // do par: ler só a linha atual mostraria "e-mail não saiu" logo depois de o
  // dedupe ter, corretamente, decidido não repetir o e-mail para aquela pessoa.
  const enviosDoPar = db
    .select({
      playerId: groupInvitations.playerId,
      ultimoEnvio: max(groupInvitations.emailSentAt).as("ultimo_envio"),
    })
    .from(groupInvitations)
    .where(eq(groupInvitations.groupId, groupId))
    .groupBy(groupInvitations.playerId)
    .as("envios_do_par");

  return db
    .select({
      id: groupInvitations.id,
      playerId: players.id,
      name: players.name,
      nickname: players.nickname,
      createdAt: groupInvitations.createdAt,
      emailSentAt: enviosDoPar.ultimoEnvio,
      // Booleano e não o endereço: a tela só precisa saber se há para onde
      // mandar — mesma forma de `temConta` em listarMembros. O join espelha a
      // elegibilidade do envio (conta ativa), para o botão não aparecer onde só
      // devolveria convite-inelegivel.
      temEmail: sql<boolean>`${users.email} is not null`,
    })
    .from(groupInvitations)
    .innerJoin(players, eq(groupInvitations.playerId, players.id))
    .leftJoin(users, and(eq(users.playerId, groupInvitations.playerId), eq(users.active, true)))
    .leftJoin(enviosDoPar, eq(enviosDoPar.playerId, groupInvitations.playerId))
    .where(and(eq(groupInvitations.groupId, groupId), eq(groupInvitations.status, "pending")))
    .orderBy(desc(groupInvitations.createdAt));
}

/** Pedidos de entrada pendentes — a fila da gestão. */
export async function pedidosPendentes(groupId: number) {
  return db
    .select({
      id: groupJoinRequests.id,
      playerId: players.id,
      name: players.name,
      nickname: players.nickname,
      createdAt: groupJoinRequests.createdAt,
    })
    .from(groupJoinRequests)
    .innerJoin(players, eq(groupJoinRequests.playerId, players.id))
    .where(and(eq(groupJoinRequests.groupId, groupId), eq(groupJoinRequests.status, "pending")))
    .orderBy(asc(groupJoinRequests.createdAt));
}

/** Tenho um pedido de entrada esperando decisão neste grupo? */
export async function temPedidoPendente(groupId: number, playerId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: groupJoinRequests.id })
    .from(groupJoinRequests)
    .where(
      and(
        eq(groupJoinRequests.groupId, groupId),
        eq(groupJoinRequests.playerId, playerId),
        eq(groupJoinRequests.status, "pending"),
      ),
    );
  return row !== undefined;
}

/** O link vivo do grupo, se houver: não revogado e dentro da validade. */
export async function linkAtivo(groupId: number) {
  const [link] = await db
    .select()
    .from(groupInviteLinks)
    .where(and(eq(groupInviteLinks.groupId, groupId), condicaoLinkVivo(sql`now()`)))
    .orderBy(desc(groupInviteLinks.createdAt));
  return link;
}

/**
 * Gera o link do grupo e revoga os ativos, no mesmo executor.
 *
 * Fica no máximo um link vivo por grupo — espelha `gerarConvite`, que apaga os
 * pendentes do jogador. Sem isso, "revogar o link" não significaria nada: os
 * anteriores continuariam abrindo a porta.
 */
export async function gerarLink(
  exec: Executor,
  groupId: number,
  createdByPlayerId: number,
  maxUses: number | null,
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await exec
    .update(groupInviteLinks)
    .set({ revokedAt: new Date() })
    .where(and(eq(groupInviteLinks.groupId, groupId), isNull(groupInviteLinks.revokedAt)));
  await exec.insert(groupInviteLinks).values({
    groupId,
    token,
    createdByPlayerId,
    maxUses,
    expiresAt: new Date(Date.now() + LINK_DURATION_MS),
  });
  return token;
}

export function urlDoLink(token: string): string {
  return `${siteUrl()}/convite-grupo/${token}`;
}

/** Quantos futs este grupo tem — o número que a tela de exclusão mostra
 *  antes de desvincular todas elas. */
export async function contarFuts(groupId: number): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(matchDays)
    .where(eq(matchDays.groupId, groupId));
  return row?.total ?? 0;
}
