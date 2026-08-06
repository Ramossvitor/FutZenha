import "server-only";
import { cache } from "react";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db";
import { players, users, type Player } from "@/db/schema";
import { SESSION_COOKIE, SESSION_DURATION_MS, verifySessionToken } from "./auth";
import { platformAdminsDoAmbiente } from "./platform-admins";

// Toda sessão é de um jogador — o admin da plataforma é um jogador com flag,
// não um papel à parte. Foi essa separação que acabou com o "um cookie = um
// papel por vez": quem administra também marca presença, avalia e é avaliado.
export type Session = {
  userId: number;
  username: string;
  player: Player;
  isPlatformAdmin: boolean;
};

// O DAL de sessão: uma consulta por request (React cache memoiza por render).
// A sessão é validada no banco — user inexistente, user.active=false ou
// token_version diferente do token ⇒ deslogado. players.active=false NÃO
// derruba a sessão (o perfil continua acessível; marcar presença é bloqueado
// na action).
export const getSession = cache(async (): Promise<Session | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const payload = await verifySessionToken(token);
  if (!payload) return null;

  const [row] = await db
    .select({ user: users, player: players })
    .from(users)
    .innerJoin(players, eq(users.playerId, players.id))
    .where(eq(users.id, payload.sub));
  if (!row || !row.user.active || row.user.tokenVersion !== payload.v) return null;

  return {
    userId: row.user.id,
    username: row.user.username,
    player: row.player,
    // O `||` da env var é a chave-mestra: um update errado em is_platform_admin
    // trancaria todo mundo do lado de fora de um banco sem shell.
    isPlatformAdmin:
      row.user.isPlatformAdmin || platformAdminsDoAmbiente().has(row.user.username),
  };
});

// Exportado porque o callback do OAuth (src/app/api/auth/google/callback) grava
// o cookie direto na NextResponse do redirect, não pelo cookies() do
// next/headers — e duas listas de opções de cookie de sessão divergiriam.
//
// `sameSite: "lax"` não é detalhe: é o que faz o cookie viajar na volta do
// Google, que é uma navegação de topo vinda de outra origem.
export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  maxAge: SESSION_DURATION_MS / 1000,
  path: "/",
} as const;

// Só pode ser chamado de Server Action (regra do Next para escrever cookie).
export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS);
}
