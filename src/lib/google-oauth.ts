// Handshake OAuth 2.0 / OpenID Connect com o Google, na mão.
//
// São três chamadas e um parse; uma biblioteca de auth aqui traria junto o
// próprio modelo de sessão, e o daqui (cookie assinado + token_version, ver
// src/lib/auth.ts) já existe e é o que o proxy do Edge sabe validar.
//
// Módulo puro de propósito — sem `server-only`, sem drizzle: `parseIdToken` é a
// parte que mais merece teste, e o vitest aqui roda sem config e sem alias.

import { base64urlDecode, base64urlDeBytes } from "./signed-blob";
import { siteUrl } from "./site-url";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

// Só escopos não-sensíveis. É o que mantém o app fora da fila de verificação do
// Google (e, portanto, de graça) — pedir qualquer coisa além disto muda o custo
// do projeto, não só o código.
const SCOPES = "openid email profile";

export type GoogleIdentity = {
  /** `sub` do Google: identificador estável da conta, imune a troca de email. */
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
};

// Lazy e com throw, no mesmo espírito do sessionSecret(): credencial ausente tem
// que estourar, não virar a string "undefined" numa query string.
function clientId(): string {
  const valor = process.env.GOOGLE_CLIENT_ID;
  if (!valor) throw new Error("GOOGLE_CLIENT_ID não definida — login pelo Google indisponível.");
  return valor;
}

function clientSecret(): string {
  const valor = process.env.GOOGLE_CLIENT_SECRET;
  if (!valor) {
    throw new Error("GOOGLE_CLIENT_SECRET não definida — login pelo Google indisponível.");
  }
  return valor;
}

/** Para a UI esconder o botão em ambiente sem credencial (preview, dev de outra pessoa). */
export function googleLoginConfigurado(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

/**
 * Tem que bater byte a byte com uma das URIs cadastradas no Google Cloud — e o
 * Google confere de novo na troca do code, então errar aqui falha nas duas
 * pontas. Como o siteUrl() cai em VERCEL_URL, que muda a cada deploy, o login
 * pelo Google só funciona onde a URL é estável: produção (com
 * NEXT_PUBLIC_SITE_URL ou domínio de produção) e localhost.
 */
export function redirectUriGoogle(): string {
  return `${siteUrl()}/api/auth/google/callback`;
}

/**
 * Lê as claims do `id_token` **sem validar a assinatura**, e isso é deliberado.
 *
 * A validação de assinatura existe para quem recebe o token por um caminho não
 * confiável (pelo navegador, no fluxo implícito). Aqui o token chega na resposta
 * de um POST nosso, por TLS, ao endpoint do Google, autenticado com o
 * client_secret — o próprio OpenID Connect Core dispensa a verificação nesse
 * caminho (§3.1.3.7, item 6). É o que evita arrastar um `jose` para dentro do
 * projeto só para reconferir o que o TLS já garantiu.
 *
 * Se um dia algum token passar a vir por outro caminho, esta dispensa cai junto.
 */
export function parseIdToken(idToken: string): GoogleIdentity | null {
  const partes = idToken.split(".");
  if (partes.length !== 3) return null;

  let claims: unknown;
  try {
    claims = JSON.parse(base64urlDecode(partes[1]));
  } catch {
    return null;
  }
  if (typeof claims !== "object" || claims === null) return null;

  const c = claims as Record<string, unknown>;
  if (typeof c.sub !== "string" || c.sub === "") return null;
  if (typeof c.email !== "string" || c.email === "") return null;

  // `iss` e `aud`, mesmo com a dispensa de assinatura acima.
  //
  // Não é redundância pelo mesmo motivo que a dispensa é válida: aquela se
  // apoia em o token ter vindo por TLS do endpoint do Google, autenticado com
  // o client_secret. Estas duas claims defendem o cenário em que ESSA premissa
  // cai — client_secret vazado e usado contra outro projeto, ou um dia em que
  // um id_token chegue por outro caminho. São quatro linhas e uma comparação de
  // string; a alternativa é confiar numa premissa sem nada por baixo.
  //
  // O Google emite `iss` nas duas formas, com e sem esquema, e as duas são
  // legítimas (OpenID Connect Core §2 e a descoberta do Google).
  if (c.iss !== "accounts.google.com" && c.iss !== "https://accounts.google.com") return null;
  // `aud` é o nosso client_id: um token emitido para outro app não vale aqui.
  if (c.aud !== clientId()) return null;

  return {
    sub: c.sub,
    email: c.email.trim().toLowerCase(),
    // O Google manda booleano, mas já mandou a string "true"; aceitar as duas
    // custa uma linha e evita recusar um login legítimo. Qualquer outra coisa é
    // não-verificado — quem decide o que fazer com isso é o google-login.ts.
    emailVerified: c.email_verified === true || c.email_verified === "true",
    name: typeof c.name === "string" && c.name !== "" ? c.name : null,
  };
}

/** Verificador PKCE: 32 bytes aleatórios em base64url. */
export function gerarCodeVerifier(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64urlDeBytes(bytes);
}

export async function codeChallengeDe(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64urlDeBytes(new Uint8Array(digest));
}

export function buildAuthUrl(opts: {
  redirectUri: string;
  state: string;
  codeChallenge: string;
  /** Email esperado, quando sabemos: pré-seleciona a conta certa no fluxo de convite. */
  loginHint?: string | null;
}): string {
  const params = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: opts.redirectUri,
    response_type: "code",
    scope: SCOPES,
    state: opts.state,
    code_challenge: opts.codeChallenge,
    code_challenge_method: "S256",
    // Sem refresh token: o id_token é usado uma vez, no login, e descartado.
    // Nada aqui fala com o Google em nome do usuário depois disso.
    access_type: "online",
    // Quem tem mais de uma conta Google no navegador precisa escolher. Sem isto
    // o Google entra direto na última usada — que, num convite, é justamente o
    // caso que a conferência de email vai barrar, e com uma mensagem confusa.
    prompt: "select_account",
  });
  if (opts.loginHint) params.set("login_hint", opts.loginHint);
  return `${AUTH_ENDPOINT}?${params}`;
}

// O `fetch` do Node não tem timeout nenhum por padrão. Sem isto, um endpoint do
// Google que aceita a conexão e não responde segura o callback até o limite da
// plataforma, com a pessoa olhando para uma página em branco — quando o que ela
// precisa é falhar rápido e clicar de novo.
const TIMEOUT_TROCA_MS = 10_000;

/**
 * Troca o `code` pela identidade. Devolve `null` para qualquer resposta que não
 * seja um id_token legível — code expirado, reusado, PKCE errado, Google fora do
 * ar ou demorando demais.
 */
export async function exchangeCode(opts: {
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<GoogleIdentity | null> {
  let res: Response;
  try {
    res = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: opts.code,
        client_id: clientId(),
        client_secret: clientSecret(),
        redirect_uri: opts.redirectUri,
        grant_type: "authorization_code",
        code_verifier: opts.codeVerifier,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_TROCA_MS),
    });
  } catch {
    // Timeout, DNS, conexão recusada: do ponto de vista de quem chamou é a mesma
    // coisa que o Google recusar a troca.
    return null;
  }
  if (!res.ok) return null;

  const data: unknown = await res.json().catch(() => null);
  if (typeof data !== "object" || data === null) return null;
  const idToken = (data as Record<string, unknown>).id_token;
  if (typeof idToken !== "string") return null;

  return parseIdToken(idToken);
}
