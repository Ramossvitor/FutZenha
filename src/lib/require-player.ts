import "server-only";
import { redirect } from "next/navigation";
import { getSession, type Session } from "./session";

// Exige um jogador logado — qualquer um. Toda sessão é de jogador desde que o
// admin deixou de ser uma senha sem dono.
export async function requirePlayer(): Promise<Session> {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  return session;
}
