import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

// Checagem otimista, só pelo cookie (sem banco) — a validação autoritativa
// fica no DAL (getSession) e dentro de cada Server Action.
export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const payload = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);

  if (pathname.startsWith("/admin") && pathname !== "/admin/login" && payload?.role !== "admin") {
    const url = request.nextUrl.clone();
    url.pathname = "/admin/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  const soDeJogador = ["/perfil", "/avaliar", "/notificacoes", "/votacao"];
  if (soDeJogador.some((rota) => pathname.startsWith(rota)) && !payload) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/perfil/:path*",
    "/avaliar/:path*",
    "/notificacoes/:path*",
    // /votacao entra aqui e não só no requirePlayer() da página porque é só o
    // proxy que monta o ?next=: sem ele, quem abre o link da notificação
    // deslogado cai na home depois do login, e não na votação que tem 48h.
    "/votacao/:path*",
  ],
};
