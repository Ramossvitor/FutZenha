import "server-only";
import { notFound, redirect } from "next/navigation";
import type { Group } from "@/db/schema";
import {
  podeCriarFutNoGrupo,
  podeGerenciarGrupo,
  podeVerGrupo,
  podeVerRankingDoGrupo,
  type Vinculo,
} from "./grupos-permissions";
import { getGrupo, papelNoGrupo } from "./grupos";
import { getSession, type Session } from "./session";

export type GrupoContexto = { session: Session; grupo: Group; papel: Vinculo };

/**
 * O tronco comum dos guards: sessão, grupo e papel, na ordem em que cada um
 * pode falhar.
 *
 * Grupo inexistente e grupo que o ator não enxerga dão o **mesmo 404** — mesma
 * decisão de `requireFutAdmin`. Aqui ela pesa mais: sem isso, varrer
 * `/grupo/1`, `/grupo/2`, ... distinguiria "não existe" de "existe e é
 * privado", que já é meio vazamento — e a diferença entre 403 e 404 é
 * exatamente o que um script precisa para mapear a plataforma.
 */
async function carregar(groupId: number): Promise<GrupoContexto> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!Number.isInteger(groupId)) notFound();

  const grupo = await getGrupo(groupId);
  if (!grupo) notFound();

  const papel = await papelNoGrupo(groupId, session.player.id);
  return { session, grupo, papel };
}

function ator(session: Session) {
  return { playerId: session.player.id, isPlatformAdmin: session.isPlatformAdmin };
}

/** Exige um jogador logado que enxergue este grupo (público, ou privado de que
 *  ele participa). */
export async function requireGrupoVisivel(groupId: number): Promise<GrupoContexto> {
  const ctx = await carregar(groupId);
  if (!podeVerGrupo(ator(ctx.session), ctx.grupo, ctx.papel)) notFound();
  return ctx;
}

/** Exige membro do grupo, em qualquer papel. */
export async function requireGrupoMembro(groupId: number): Promise<GrupoContexto> {
  const ctx = await carregar(groupId);
  if (!podeVerRankingDoGrupo(ator(ctx.session), ctx.papel)) notFound();
  return ctx;
}

/**
 * Exige quem cria fut e convida: admin ou organizador do grupo.
 *
 * Um teste só, e não o `&&` de `podeCriarFutNoGrupo` com
 * `podeConvidarParaGrupo`: os dois predicados têm o mesmo corpo, então o segundo
 * nunca discordava do primeiro — só dava a impressão de que poderia.
 */
export async function requireGrupoOrganizador(groupId: number): Promise<GrupoContexto> {
  const ctx = await carregar(groupId);
  if (!podeCriarFutNoGrupo(ator(ctx.session), ctx.papel)) notFound();
  return ctx;
}

/** Exige o admin do grupo (ou o admin da plataforma, fallback de sempre). */
export async function requireGrupoAdmin(groupId: number): Promise<GrupoContexto> {
  const ctx = await carregar(groupId);
  if (!podeGerenciarGrupo(ator(ctx.session), ctx.papel)) notFound();
  return ctx;
}
