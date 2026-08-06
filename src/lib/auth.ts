// Sessão em cookie: um blob assinado (ver src/lib/signed-blob.ts) cujo payload
// diz quem está logado. A validação autoritativa (conta ativa, token_version)
// fica no DAL (src/lib/session.ts), que consulta o banco a cada request.

import { signBlob, verifyBlob } from "./signed-blob";

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
export function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET não definida — impossível assinar ou validar sessões.");
  }
  return secret;
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
  return signBlob(payload, sessionSecret());
}

export async function createSessionToken(data: { sub: number; v: number }): Promise<string> {
  return signSessionPayload({ sub: data.sub, v: data.v, exp: Date.now() + SESSION_DURATION_MS });
}

export async function verifySessionToken(token: string | undefined): Promise<SessionPayload | null> {
  // Tokens no formato antigo ("exp.assinatura") reprovam no parse do verifyBlob.
  const payload = await verifyBlob(token, sessionSecret());
  if (!isSessionPayload(payload) || payload.exp < Date.now()) return null;
  // Devolve só os campos conhecidos. Cookies em circulação ainda carregam
  // `role` do modelo de dois papéis e `pa` do gate antigo do proxy; deixá-los
  // atravessar convidaria alguém a lê-los como se valessem alguma coisa.
  return { sub: payload.sub, v: payload.v, exp: payload.exp };
}
