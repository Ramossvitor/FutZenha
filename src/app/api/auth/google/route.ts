import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { invites } from "@/db/schema";
import {
  buildAuthUrl,
  codeChallengeDe,
  gerarCodeVerifier,
  googleLoginConfigurado,
  redirectUriGoogle,
} from "@/lib/google-oauth";
import {
  assinarOAuthCookie,
  assinarOAuthState,
  destinoSeguro,
  gerarNonce,
  OAUTH_COOKIE,
  OAUTH_DURATION_MS,
  type OAuthPendente,
} from "@/lib/oauth-state";
import { getSession } from "@/lib/session";
import { siteUrl } from "@/lib/site-url";

// Início do fluxo: guarda o que precisa sobreviver à ida ao Google e redireciona.
//
// É Route Handler, e não Server Action, porque o Google volta por GET — e porque
// aqui já vale escrever cookie na própria resposta do redirect.
//
// Não há guard: esta rota não conta nada a quem chama, ela só monta uma URL do
// Google. Quem autoriza é o callback, e antes dele o próprio Google. O único
// caso com sessão é `?vincular=1`, que exige estar logado por definição.
export async function GET(request: NextRequest) {
  const base = siteUrl();
  if (!googleLoginConfigurado()) {
    return NextResponse.redirect(new URL("/login?erro=google-indisponivel", base));
  }

  const params = request.nextUrl.searchParams;
  const convite = params.get("convite");
  const next = destinoSeguro(params.get("next"));

  const pendente: OAuthPendente = {
    n: gerarNonce(),
    cv: gerarCodeVerifier(),
    exp: Date.now() + OAUTH_DURATION_MS,
  };
  if (convite) pendente.t = convite;
  if (next !== "/") pendente.next = next;

  if (params.get("vincular") === "1") {
    const session = await getSession();
    if (!session) return NextResponse.redirect(new URL("/login?next=/perfil", base));
    pendente.link = session.userId;
  }

  // Pré-seleciona a conta certa na tela do Google. É só dica de UI — quem decide
  // é a conferência de email no callback —, mas evita o vaivém de quem tem duas
  // contas logadas no navegador e escolhe a errada.
  let loginHint: string | null = null;
  if (convite) {
    const [invite] = await db
      .select({ email: invites.email })
      .from(invites)
      .where(eq(invites.token, convite));
    loginHint = invite?.email ?? null;
  }

  const url = buildAuthUrl({
    redirectUri: redirectUriGoogle(),
    state: await assinarOAuthState({ n: pendente.n, exp: pendente.exp }),
    codeChallenge: await codeChallengeDe(pendente.cv),
    loginHint,
  });

  const response = NextResponse.redirect(url);
  response.cookies.set(OAUTH_COOKIE, await assinarOAuthCookie(pendente), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: OAUTH_DURATION_MS / 1000,
    path: "/",
  });
  return response;
}
