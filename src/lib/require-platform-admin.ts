import "server-only";
import { notFound, redirect } from "next/navigation";
import { getSession, type Session } from "./session";

/**
 * Exige o admin da plataforma. Vale para toda página e toda action sob /admin.
 *
 * Defesa em profundidade: o proxy já barra /admin/* pelo cookie, mas ele é uma
 * checagem otimista no Edge (a flag vem do token, que pode estar velho) e
 * Server Actions são endpoints públicos que nem passam por lá. A autoridade é
 * esta função, que lê `users.is_platform_admin` do banco a cada request.
 *
 * Logado sem a flag responde 404 em vez de redirecionar: mandar para /login
 * quem já está logado daria um loop, e não revelar que a rota existe é de graça.
 */
export async function requirePlatformAdmin(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.isPlatformAdmin) notFound();
  return session;
}
