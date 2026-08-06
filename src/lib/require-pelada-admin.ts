import "server-only";
import { eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { db } from "@/db";
import { matchDays, type MatchDay } from "@/db/schema";
import { podeGerenciarPelada } from "./permissions";
import { getSession, type Session } from "./session";

export type PeladaAdmin = { session: Session; matchDay: MatchDay };

/**
 * Exige quem administra esta pelada: o criador ou o admin da plataforma.
 *
 * Devolve a pelada junto com a sessão de propósito — quase toda action precisa
 * da linha logo em seguida (para `assertEscalacaoEditavel`/`assertPlacarEditavel`),
 * e sem isso cada uma leria a mesma pelada duas vezes.
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

  const ator = { playerId: session.player.id, isPlatformAdmin: session.isPlatformAdmin };
  if (!podeGerenciarPelada(ator, matchDay)) notFound();

  return { session, matchDay };
}
