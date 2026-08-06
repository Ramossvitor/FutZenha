import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";
import { resolverLoginGoogle } from "@/lib/google-login";
import { exchangeCode, redirectUriGoogle } from "@/lib/google-oauth";
import { destinoSeguro, lerOAuthCookie, lerOAuthState, OAUTH_COOKIE } from "@/lib/oauth-state";
import { SESSION_COOKIE_OPTIONS } from "@/lib/session";
import { siteUrl } from "@/lib/site-url";

// A volta do Google. A ordem aqui é de propósito: primeiro provamos que este
// callback responde a um pedido que saiu daqui (cookie + state), e só depois
// gastamos uma ida à rede para trocar o code.
export async function GET(request: NextRequest) {
  const base = siteUrl();
  const params = request.nextUrl.searchParams;

  const pendente = await lerOAuthCookie(request.cookies.get(OAUTH_COOKIE)?.value);

  // O erro tem que cair onde a pessoa consegue tentar de novo:
  //
  // - vinculando: já está logada, e /login manda logado de volta para a home —
  //   o erro se perderia no caminho;
  // - resgatando convite: só a página do convite tem o botão do Google com o
  //   token junto. Mandar para /login seria beco sem saída, porque de lá o
  //   próximo login sai sem convite nenhum e falha com "sem-convite".
  const paginaDeErro =
    pendente?.link !== undefined
      ? "/perfil"
      : pendente?.t
        ? `/convite/${encodeURIComponent(pendente.t)}`
        : "/login";

  const falhar = (erro: string, extra?: Record<string, string>) => {
    const url = new URL(paginaDeErro, base);
    url.searchParams.set("erro", erro);
    for (const [chave, valor] of Object.entries(extra ?? {})) url.searchParams.set(chave, valor);
    const response = NextResponse.redirect(url);
    response.cookies.delete(OAUTH_COOKIE);
    return response;
  };

  if (!pendente) return falhar("sessao-expirada");

  // O nonce casa este callback com o cookie que abrimos: sem ele, um link
  // forjado com um `code` de terceiro logaria a vítima na conta do atacante.
  const state = await lerOAuthState(params.get("state") ?? undefined);
  if (!state || state.n !== pendente.n) return falhar("state-invalido");

  // Quem fecha a tela do Google ou nega o acesso volta com `error` e sem `code`.
  if (params.get("error") || !params.get("code")) return falhar("cancelado");

  const identidade = await exchangeCode({
    code: params.get("code")!,
    redirectUri: redirectUriGoogle(),
    codeVerifier: pendente.cv,
  });
  if (!identidade) return falhar("troca-falhou");

  // O try/catch é o que separa "não deu" de tela de erro do Next: sem ele, um
  // throw daqui para dentro (banco fora do ar, username sem variação livre)
  // vira 500 com o cookie do OAuth ainda de pé, e a pessoa fica sem nem o
  // caminho de tentar de novo.
  let resultado;
  try {
    resultado = await resolverLoginGoogle(identidade, pendente);
  } catch (error) {
    console.error("[auth/google] falha ao resolver o login", error);
    return falhar("erro-inesperado");
  }
  if (!resultado.ok) {
    return falhar(resultado.erro, resultado.emailEsperado ? { esperado: resultado.emailEsperado } : undefined);
  }

  const response = NextResponse.redirect(new URL(destinoSeguro(pendente.next), base));
  response.cookies.set(SESSION_COOKIE, resultado.token, SESSION_COOKIE_OPTIONS);
  response.cookies.delete(OAUTH_COOKIE);
  return response;
}
