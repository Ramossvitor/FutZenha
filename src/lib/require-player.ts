import "server-only";
import { redirect } from "next/navigation";
import { getSession, type PlayerSession } from "./session";

// Equivalente do requireAdmin para páginas e actions de jogador logado.
export async function requirePlayer(): Promise<PlayerSession> {
  const session = await getSession();
  if (!session || session.role !== "player") {
    redirect("/login");
  }
  return session;
}
