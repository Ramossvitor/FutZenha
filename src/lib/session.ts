import "server-only";
import { cache } from "react";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db";
import { players, users, type Player } from "@/db/schema";
import { SESSION_COOKIE, SESSION_DURATION_MS, verifySessionToken } from "./auth";

export type PlayerSession = {
  role: "player";
  userId: number;
  username: string;
  player: Player;
};

export type Session = { role: "admin" } | PlayerSession;

// O DAL de sessão: uma consulta por request (React cache memoiza por render).
// A sessão de player é validada no banco — user inexistente, user.active=false
// ou token_version diferente do token ⇒ deslogado. players.active=false NÃO
// derruba a sessão (o perfil continua acessível; marcar presença é bloqueado
// na action). Sessão de admin não consulta o banco.
export const getSession = cache(async (): Promise<Session | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const payload = await verifySessionToken(token);
  if (!payload) return null;
  if (payload.role === "admin") return { role: "admin" };
  if (payload.sub === null) return null;

  const [row] = await db
    .select({ user: users, player: players })
    .from(users)
    .innerJoin(players, eq(users.playerId, players.id))
    .where(eq(users.id, payload.sub));
  if (!row || !row.user.active || row.user.tokenVersion !== payload.v) return null;

  return { role: "player", userId: row.user.id, username: row.user.username, player: row.player };
});

// Só pode ser chamado de Server Action (regra do Next para escrever cookie).
export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_DURATION_MS / 1000,
    path: "/",
  });
}
