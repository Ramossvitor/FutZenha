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
import { getGrupo, getGrupoPorSlug, papelNoGrupo } from "./grupos";
import { getSession, type Session } from "./session";
import { ehSlug } from "./slug";

export type GrupoContexto = { session: Session; grupo: Group; papel: Vinculo };

/**
 * Como o grupo foi endereçado: pelo slug, quando veio da URL, ou pelo id,
 * quando veio de uma action (que recebe id pelo `.bind`, nunca pela rota).
 */
export type RefDoGrupo = number | string;

/**
 * O tronco comum dos guards: sessão, grupo e papel, na ordem em que cada um
 * pode falhar.
 *
 * Grupo inexistente e grupo que o ator não enxerga dão o **mesmo 404** — mesma
 * decisão de `requireFutAdmin`. Aqui ela pesa mais: sem isso, varrer
 * `/grupo/1`, `/grupo/2`, ... distinguiria "não existe" de "existe e é
 * privado", que já é meio vazamento — e a diferença entre 403 e 404 é
 * exatamente o que um script precisa para mapear a plataforma. A varredura em
 * si ficou impraticável quando a URL virou slug, mas a regra continua: é a
 * resposta uniforme que não deixa o 404 virar oráculo.
 */
async function carregar(ref: RefDoGrupo): Promise<GrupoContexto> {
  const session = await getSession();
  if (!session) redirect("/login");

  // Id numérico na URL era o endereço antigo; hoje `ehSlug` o recusa e a página
  // dá 404 sem chegar ao banco.
  const grupo =
    typeof ref === "string"
      ? ehSlug(ref)
        ? await getGrupoPorSlug(ref)
        : undefined
      : Number.isInteger(ref)
        ? await getGrupo(ref)
        : undefined;
  if (!grupo) notFound();

  const papel = await papelNoGrupo(grupo.id, session.player.id);
  return { session, grupo, papel };
}

function ator(session: Session) {
  return { playerId: session.player.id, isPlatformAdmin: session.isPlatformAdmin };
}

/** Exige um jogador logado que enxergue este grupo (público, ou privado de que
 *  ele participa). */
export async function requireGrupoVisivel(ref: RefDoGrupo): Promise<GrupoContexto> {
  const ctx = await carregar(ref);
  if (!podeVerGrupo(ator(ctx.session), ctx.grupo, ctx.papel)) notFound();
  return ctx;
}

/** Exige membro do grupo, em qualquer papel. */
export async function requireGrupoMembro(ref: RefDoGrupo): Promise<GrupoContexto> {
  const ctx = await carregar(ref);
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
export async function requireGrupoOrganizador(ref: RefDoGrupo): Promise<GrupoContexto> {
  const ctx = await carregar(ref);
  if (!podeCriarFutNoGrupo(ator(ctx.session), ctx.papel)) notFound();
  return ctx;
}

/** Exige o admin do grupo (ou o admin da plataforma, fallback de sempre). */
export async function requireGrupoAdmin(ref: RefDoGrupo): Promise<GrupoContexto> {
  const ctx = await carregar(ref);
  if (!podeGerenciarGrupo(ator(ctx.session), ctx.papel)) notFound();
  return ctx;
}
