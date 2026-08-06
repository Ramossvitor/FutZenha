import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { attendances, users } from "@/db/schema";
import { podeDefinirPresencaPor } from "./permissions";
import type { Session } from "./session";

/**
 * Os dois fatos que decidem se alguém pode ser marcado por outra pessoa nesta
 * pelada. A regra em si é pura e mora em src/lib/permissions.ts.
 */
export type AlvoDePresenca = { temContaAtiva: boolean; jaEstaNaPelada: boolean };

async function situacaoDoAlvo(matchDayId: number, playerId: number): Promise<AlvoDePresenca> {
  const [conta] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.playerId, playerId), eq(users.active, true)));
  const [presenca] = await db
    .select({ playerId: attendances.playerId })
    .from(attendances)
    .where(and(eq(attendances.matchDayId, matchDayId), eq(attendances.playerId, playerId)));

  return { temContaAtiva: conta !== undefined, jaEstaNaPelada: presenca !== undefined };
}

/**
 * Se esta sessão pode mexer na presença/escalação deste jogador nesta pelada.
 *
 * Consultado pelas actions que recebem `playerId` do cliente — a tela só
 * oferece quem faz sentido, mas Server Action é endpoint público e não passa
 * pelo proxy (node_modules/next/dist/docs/01-app/02-guides/data-security.md).
 */
export async function podeMarcarPor(
  session: Session,
  matchDayId: number,
  playerId: number,
): Promise<boolean> {
  const ator = { playerId: session.player.id, isPlatformAdmin: session.isPlatformAdmin };
  // Marcar por si mesmo é sempre permitido: é o caso normal de quem organiza a
  // própria pelada e confirma a própria presença pela tela de gestão.
  if (playerId === session.player.id) return true;
  return podeDefinirPresencaPor(ator, await situacaoDoAlvo(matchDayId, playerId));
}
