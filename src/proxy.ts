import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

// Checagem otimista, só pelo cookie (sem banco) — a validação autoritativa
// fica no DAL (getSession) e dentro de cada Server Action.
export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const payload = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);

  // O proxy só pergunta "tem alguém logado?" — inclusive em /admin.
  //
  // Já houve aqui um gate que lia um `pa` gravado no cookie. Não dava para
  // manter: o cookie é escrito no login e a env var PLATFORM_ADMIN_USERNAMES
  // muda sem redeploy, então quem virava admin pela chave-mestra via o link
  // "Admin" no cabeçalho (montado pelo getSession, que consulta a env var) e era
  // rebatido para a home ao clicar — justamente na emergência em que a
  // chave-mestra existe para servir. E o gate não protegia nada: a autoridade é
  // o requirePlatformAdmin() de cada página e action, que relê a flag do banco,
  // e Server Action é POST direto que nem passa por aqui
  // (node_modules/next/dist/docs/01-app/02-guides/data-security.md).
  const prefixos = ["/admin", "/perfil", "/avaliar", "/notificacoes", "/votacao", "/peladas/nova"];
  // A gestão da pelada fica embaixo de uma rota dinâmica, então não dá para
  // casar por prefixo como as outras.
  const gerenciarPelada = /^\/pelada\/[^/]+\/gerenciar(\/|$)/;
  const exigeLogin =
    prefixos.some((rota) => pathname.startsWith(rota)) || gerenciarPelada.test(pathname);

  if (exigeLogin && !payload) {
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
    "/peladas/nova",
    // Os dois padrões são necessários: ":path*" não casa o caminho sem sufixo.
    "/pelada/:id/gerenciar",
    "/pelada/:id/gerenciar/:path*",
  ],
};
