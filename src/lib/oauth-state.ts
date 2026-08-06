// O estado que atravessa a ida ao Google e precisa voltar intacto.
//
// Ele mora em dois lugares, e a divisão é o ponto do módulo:
//
// - **O cookie** (httpOnly, nosso, 10 minutos) carrega tudo: o verificador PKCE,
//   o convite sendo resgatado, o destino. Nada disso sai da nossa origem.
// - **O `state` da URL** carrega só o nonce. Ele passa pelo navegador e pelos
//   logs do Google, então leva o mínimo — o trabalho dele é um só: provar, na
//   volta, que o callback responde a um pedido que saiu daqui (CSRF).
//
// O convite ficar no cookie e não no `state` é deliberado: o token do convite é
// credencial de cadastro, e não há por que registrá-lo no servidor de terceiro.
//
// Módulo puro (sem `server-only`, sem drizzle) para rodar no vitest.

import { sessionSecret } from "./auth";
import { base64urlDeBytes, signBlob, verifyBlob } from "./signed-blob";

export const OAUTH_COOKIE = "futzenha_oauth";

// Curto de propósito: é o tempo de escolher uma conta na tela do Google, não o
// de uma sessão. Um state velho circulando é superfície à toa.
export const OAUTH_DURATION_MS = 1000 * 60 * 10; // 10 minutos

export type OAuthPendente = {
  /** Nonce; casa este cookie com o `state` que volta na URL. */
  n: string;
  /** `code_verifier` do PKCE. */
  cv: string;
  exp: number;
  /** Token do convite sendo resgatado, quando o fluxo começou em /convite/[token]. */
  t?: string;
  /** `users.id` que está vinculando uma conta Google à conta de senha que já tem. */
  link?: number;
  /** Destino interno depois do login. */
  next?: string;
};

export type OAuthState = { n: string; exp: number };

// Domínios de assinatura (ver signBlob): o cookie e o state têm o mesmo segredo
// e formatos parecidos o bastante para um passar pelo outro — o `n` e o `exp`
// do cookie satisfazem, sozinhos, tudo que o lerOAuthState exige.
const KIND_COOKIE = "oauth-cookie:";
const KIND_STATE = "oauth-state:";

export function gerarNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return base64urlDeBytes(bytes);
}

export async function assinarOAuthCookie(pendente: OAuthPendente): Promise<string> {
  return signBlob(pendente, sessionSecret(), KIND_COOKIE);
}

export async function lerOAuthCookie(valor: string | undefined): Promise<OAuthPendente | null> {
  const p = await verifyBlob(valor, sessionSecret(), KIND_COOKIE);
  if (typeof p !== "object" || p === null) return null;
  const v = p as Record<string, unknown>;
  if (typeof v.n !== "string" || v.n === "") return null;
  if (typeof v.cv !== "string" || v.cv === "") return null;
  if (typeof v.exp !== "number" || v.exp < Date.now()) return null;
  if (v.t !== undefined && typeof v.t !== "string") return null;
  if (v.link !== undefined && !Number.isInteger(v.link)) return null;
  if (v.next !== undefined && typeof v.next !== "string") return null;

  return {
    n: v.n,
    cv: v.cv,
    exp: v.exp,
    ...(typeof v.t === "string" ? { t: v.t } : {}),
    ...(typeof v.link === "number" ? { link: v.link } : {}),
    ...(typeof v.next === "string" ? { next: v.next } : {}),
  };
}

export async function assinarOAuthState(state: OAuthState): Promise<string> {
  return signBlob(state, sessionSecret(), KIND_STATE);
}

export async function lerOAuthState(valor: string | undefined): Promise<OAuthState | null> {
  const s = await verifyBlob(valor, sessionSecret(), KIND_STATE);
  if (typeof s !== "object" || s === null) return null;
  const v = s as Record<string, unknown>;
  if (typeof v.n !== "string" || v.n === "") return null;
  if (typeof v.exp !== "number" || v.exp < Date.now()) return null;
  return { n: v.n, exp: v.exp };
}

/**
 * Destino interno seguro, ou "/". Barra o open redirect.
 *
 * Não basta recusar "//evil.com": em esquema especial (http/https) o parser de
 * URL trata "\" como "/", então "/\evil.com" também vira autoridade externa —
 * `new URL("/\\evil.com", base)` devolve "https://evil.com/", e um `Location`
 * cru com a barra invertida é normalizado pelo navegador do mesmo jeito.
 *
 * Daí o teste ser sobre a forma (uma barra, e o caractere seguinte não pode
 * abrir autoridade) e não uma lista de prefixos proibidos.
 */
export function destinoSeguro(next: string | null | undefined): string {
  return next && /^\/[^/\\]/.test(next) ? next : "/";
}
