// Sessão do admin: token "exp.assinatura" com HMAC-SHA256 (Web Crypto,
// funciona tanto no runtime Node quanto no Edge/proxy).

export const SESSION_COOKIE = "futzenha_session";

const SESSION_DURATION_MS = 1000 * 60 * 60 * 24 * 30; // 30 dias

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

export async function createSessionToken(): Promise<string> {
  const exp = String(Date.now() + SESSION_DURATION_MS);
  return `${exp}.${await hmac(exp, process.env.SESSION_SECRET!)}`;
}

export async function verifySessionToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const [exp, sig] = token.split(".");
  if (!exp || !sig) return false;
  if (Number(exp) < Date.now()) return false;
  const expected = await hmac(exp, process.env.SESSION_SECRET!);
  if (sig.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
