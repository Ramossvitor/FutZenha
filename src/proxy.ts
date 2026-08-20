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
  const prefixos = [
    "/admin",
    "/perfil",
    // O perfil público é link de compartilhar: sai no zap e é aberto por gente
    // que não está logada. Sem o prefixo, o ?next= não é montado e a pessoa cai
    // na home depois do login, longe de quem ela foi ver.
    "/jogador",
    "/avaliar",
    "/notificacoes",
    "/votacao",
    "/futs/novo",
    "/grupos",
    // O link do grupo é o caso mais dependente daqui: ele corre no WhatsApp e
    // quase sempre é aberto por alguém deslogado. Sem este prefixo, o ?next=
    // não é montado, a pessoa cai na home depois do login e o token se perde.
    "/convite-grupo",
    // Mesmo motivo do /convite-grupo: o link do fut corre no WhatsApp e quase
    // sempre é aberto por quem não está logado. Sem o prefixo, o ?next= não é
    // montado e a pessoa cai na home depois do login, longe do fut.
    "/convite-fut",
  ];
  // Gestão de fut e de grupo ficam embaixo de rotas dinâmicas, então não dá
  // para casar por prefixo como as outras.
  const gerenciarFut = /^\/fut\/[^/]+\/gerenciar(\/|$)/;
  const gerenciarGrupo = /^\/grupo\/[^/]+\/gerenciar(\/|$)/;
  // O ranking do grupo entra pelo mesmo motivo do /convite-grupo: é link que
  // corre no WhatsApp e quase sempre é aberto por alguém deslogado. O guard da
  // página (requireGrupoMembro) manda para /login sem `next`, então sem esta
  // linha a pessoa faz login e cai na home, longe do que foi ver.
  const rankingDoGrupo = /^\/grupo\/[^/]+\/ranking$/;
  const exigeLogin =
    prefixos.some((rota) => pathname.startsWith(rota)) ||
    gerenciarFut.test(pathname) ||
    gerenciarGrupo.test(pathname) ||
    rankingDoGrupo.test(pathname);

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
    "/jogador/:path*",
    "/avaliar/:path*",
    "/notificacoes/:path*",
    // /votacao entra aqui e não só no requirePlayer() da página porque é só o
    // proxy que monta o ?next=: sem ele, quem abre o link da notificação
    // deslogado cai na home depois do login, e não na votação que tem 48h.
    "/votacao/:path*",
    "/futs/novo",
    // /grupos inteiro exige login: a lista mistura os grupos de que a pessoa
    // participa com os convites pendentes dela. A página pública de um grupo
    // fica em /grupo/:id (singular), que de propósito não está aqui.
    "/grupos",
    "/grupos/:path*",
    "/convite-grupo/:path*",
    "/convite-fut/:path*",
    // Os dois padrões são necessários: ":path*" não casa o caminho sem sufixo.
    "/fut/:id/gerenciar",
    "/fut/:id/gerenciar/:path*",
    "/grupo/:id/gerenciar",
    "/grupo/:id/gerenciar/:path*",
    "/grupo/:id/ranking",
  ],
};
