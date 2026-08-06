// Blob assinado: "base64url(JSON do payload).assinatura HMAC-SHA256". É a
// primitiva por trás de dois usos com prazos e formatos diferentes, mas com a
// mesma necessidade — entregar um dado ao cliente e recebê-lo de volta intacto:
// o cookie de sessão (src/lib/auth.ts) e o state do OAuth (src/lib/oauth-state.ts).
//
// Web Crypto e btoa/atob de propósito, sem Buffer e sem node:crypto: o mesmo
// código roda no runtime Node e no Edge, onde o proxy valida a sessão.

export async function hmacHex(data: string, secret: string): Promise<string> {
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

// UTF-8 explícito nos dois sentidos. btoa/atob operam sobre latin1, e o state do
// OAuth carrega um `next` vindo da URL — um acento ali faria o btoa lançar. Para
// payload ASCII (o caso da sessão) o resultado é byte a byte o mesmo de antes,
// então os cookies em circulação seguem válidos.
export function base64urlDeBytes(bytes: Uint8Array): string {
  let binario = "";
  for (const byte of bytes) binario += String.fromCharCode(byte);
  return btoa(binario).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function base64urlEncode(text: string): string {
  return base64urlDeBytes(new TextEncoder().encode(text));
}

export function base64urlDecode(data: string): string {
  const base64 = data.replaceAll("-", "+").replaceAll("_", "/");
  const binario = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  const bytes = Uint8Array.from(binario, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Comparação em tempo constante — o custo é irrisório e o vazamento, silencioso. */
export function assinaturaConfere(recebida: string, esperada: string): boolean {
  if (recebida.length !== esperada.length) return false;
  let diff = 0;
  for (let i = 0; i < esperada.length; i++) diff |= recebida.charCodeAt(i) ^ esperada.charCodeAt(i);
  return diff === 0;
}

export async function signBlob(payload: unknown, secret: string): Promise<string> {
  const encoded = base64urlEncode(JSON.stringify(payload));
  return `${encoded}.${await hmacHex(encoded, secret)}`;
}

/**
 * Confere a assinatura e devolve o JSON cru; devolve `null` em qualquer falha.
 *
 * Validar formato, prazo e significado é com quem chamou — esta função só
 * responde "isto saiu daqui e não foi mexido". Tokens em outro formato (o antigo
 * "exp.assinatura", por exemplo) reprovam no JSON.parse.
 */
export async function verifyBlob(token: string | undefined, secret: string): Promise<unknown> {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot < 0) return null;
  const encoded = token.slice(0, dot);

  if (!assinaturaConfere(token.slice(dot + 1), await hmacHex(encoded, secret))) return null;

  try {
    return JSON.parse(base64urlDecode(encoded));
  } catch {
    return null;
  }
}
