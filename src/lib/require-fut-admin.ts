import "server-only";
import { eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { db } from "@/db";
import { matchDays, type MatchDay } from "@/db/schema";
import { papelNoGrupo } from "./grupos";
import { podeGerenciarFut } from "./permissions";
import { getSession, type Session } from "./session";

export type FutAdmin = { session: Session; matchDay: MatchDay };

/**
 * Exige quem administra este fut: o criador, o admin da plataforma ou — em
 * fut de grupo — o admin daquele grupo.
 *
 * Devolve o fut junto com a sessão de propósito — quase toda action precisa
 * da linha logo em seguida (para `assertEscalacaoEditavel`/`assertPlacarEditavel`),
 * e sem isso cada uma leria o mesmo fut duas vezes. O papel no grupo NÃO vai
 * junto: ele só serve à decisão aqui dentro, e nenhuma das actions o consulta.
 *
 * O papel sai de `matchDay.groupId`, nunca de um id vindo do cliente — é isso
 * que torna segura a assinatura de três parâmetros de `podeGerenciarFut`.
 * Uma action que aceitasse `groupId` do formulário e o repassasse aqui deixaria
 * qualquer admin de qualquer grupo gerenciar qualquer fut.
 *
 * Fut inexistente e fut de outro dão o mesmo 404: quem não administra não
 * precisa saber que o id existe.
 */
export async function requireFutAdmin(matchDayId: number): Promise<FutAdmin> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!Number.isInteger(matchDayId)) notFound();

  const [matchDay] = await db.select().from(matchDays).where(eq(matchDays.id, matchDayId));
  if (!matchDay) notFound();

  const papel =
    matchDay.groupId !== null ? await papelNoGrupo(matchDay.groupId, session.player.id) : null;

  const ator = { playerId: session.player.id, isPlatformAdmin: session.isPlatformAdmin };
  if (!podeGerenciarFut(ator, matchDay, papel)) notFound();

  return { session, matchDay };
}
