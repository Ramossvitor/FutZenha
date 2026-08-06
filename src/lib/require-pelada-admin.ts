import "server-only";
import { eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { db } from "@/db";
import { matchDays, type MatchDay } from "@/db/schema";
import { papelNoGrupo } from "./grupos";
import { podeGerenciarPelada } from "./permissions";
import { getSession, type Session } from "./session";

export type PeladaAdmin = { session: Session; matchDay: MatchDay };

/**
 * Exige quem administra esta pelada: o criador, o admin da plataforma ou — em
 * pelada de grupo — o admin daquele grupo.
 *
 * Devolve a pelada junto com a sessão de propósito — quase toda action precisa
 * da linha logo em seguida (para `assertEscalacaoEditavel`/`assertPlacarEditavel`),
 * e sem isso cada uma leria a mesma pelada duas vezes. O papel no grupo NÃO vai
 * junto: ele só serve à decisão aqui dentro, e nenhuma das actions o consulta.
 *
 * O papel sai de `matchDay.groupId`, nunca de um id vindo do cliente — é isso
 * que torna segura a assinatura de três parâmetros de `podeGerenciarPelada`.
 * Uma action que aceitasse `groupId` do formulário e o repassasse aqui deixaria
 * qualquer admin de qualquer grupo gerenciar qualquer pelada.
 *
 * Pelada inexistente e pelada de outro dão o mesmo 404: quem não administra não
 * precisa saber que o id existe.
 */
export async function requirePeladaAdmin(matchDayId: number): Promise<PeladaAdmin> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!Number.isInteger(matchDayId)) notFound();

  const [matchDay] = await db.select().from(matchDays).where(eq(matchDays.id, matchDayId));
  if (!matchDay) notFound();

  const papel =
    matchDay.groupId !== null ? await papelNoGrupo(matchDay.groupId, session.player.id) : null;

  const ator = { playerId: session.player.id, isPlatformAdmin: session.isPlatformAdmin };
  if (!podeGerenciarPelada(ator, matchDay, papel)) notFound();

  return { session, matchDay };
}
