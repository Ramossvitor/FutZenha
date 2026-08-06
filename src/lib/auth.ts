// Sessão em cookie: token "base64url(payload JSON).assinatura" com HMAC-SHA256
// (Web Crypto, funciona tanto no runtime Node quanto no Edge/proxy). O payload
// diz quem está logado; a validação autoritativa (conta ativa, token_version)
// fica no DAL (src/lib/session.ts), que consulta o banco a cada request.

export const SESSION_COOKIE = "futzenha_session";

export const SESSION_DURATION_MS = 1000 * 60 * 60 * 24 * 30; // 30 dias

// O cookie diz apenas QUEM é, nunca o que pode. Papel não entra aqui: ele muda
// no banco e na env var sem que o cookie saiba, e um cookie de 30 dias
// carregando permissão só produz divergência — quem decide é o DAL
// (src/lib/session.ts), que relê tudo a cada request.
export type SessionPayload = {
  sub: number; // users.id
  v: number; // users.token_version na hora do login
  exp: number; // epoch ms
};

// Lazy de propósito: os testes definem a env var depois de importar o módulo.
// Sem esta checagem, um SESSION_SECRET ausente assinaria com a string
// "undefined" — cookie de admin forjável, e silenciosamente.
function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET não definida — impossível assinar ou validar sessões.");
  }
  return secret;
}

async function hmac(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// base64url via btoa/atob (sem Buffer) para rodar igual em Node e Edge.
// O payload é JSON ASCII, então não há problema de codificação.
function base64urlEncode(data: string): string {
  return btoa(data).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function base64urlDecode(data: string): string {
  const base64 = data.replaceAll("-", "+").replaceAll("_", "/");
  return atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
}

// Exigir `sub` numérico é o que mata as sessões do admin de senha global, que
// gravava `sub: null` — sem isso, `eq(users.id, null)` viraria SQL inválido no
// DAL. Campos a mais são ignorados de propósito: os cookies em circulação ainda
// carregam o `role: "player"` do modelo antigo (e, por um tempo, um `pa`), e
// recusá-los deslogaria todo mundo à toa. Ignorar é seguro porque nada aqui
// concede permissão: papel é lido do banco a cada request.
function isSessionPayload(value: unknown): value is SessionPayload {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.sub === "number" && typeof v.v === "number" && typeof v.exp === "number";
}

// Exportado separado de createSessionToken para os testes forjarem exp no passado.
export async function signSessionPayload(payload: SessionPayload): Promise<string> {
  const encoded = base64urlEncode(JSON.stringify(payload));
  return `${encoded}.${await hmac(encoded, sessionSecret())}`;
}

export async function createSessionToken(data: { sub: number; v: number }): Promise<string> {
  return signSessionPayload({ sub: data.sub, v: data.v, exp: Date.now() + SESSION_DURATION_MS });
}

export async function verifySessionToken(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot < 0) return null;
  const encoded = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const expected = await hmac(encoded, sessionSecret());
  if (sig.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return null;

  // Tokens no formato antigo ("exp.assinatura") reprovam aqui no parse.
  let payload: unknown;
  try {
    payload = JSON.parse(base64urlDecode(encoded));
  } catch {
    return null;
  }
  if (!isSessionPayload(payload) || payload.exp < Date.now()) return null;
  // Devolve só os campos conhecidos. Cookies em circulação ainda carregam
  // `role` do modelo de dois papéis e `pa` do gate antigo do proxy; deixá-los
  // atravessar convidaria alguém a lê-los como se valessem alguma coisa.
  return { sub: payload.sub, v: payload.v, exp: payload.exp };
}
