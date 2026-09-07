// O token de API do relógio — a credencial com que o Atalho do Apple Watch
// opera a súmula ao vivo (src/app/api/sumula). Módulo puro, sem `server-only`,
// pelo mesmo motivo de ./segredo.ts: as três funções vão de string a string, e
// é assim que o teste unitário as alcança.
//
// Formato: "fz_" + 32 bytes aleatórios em base64url — os mesmos 32 bytes dos
// convites (./convites.ts). O prefixo não é enfeite: é o que deixa
// `extrairBearer` recusar cedo um header que não é nosso, sem ir ao banco, e o
// que torna o token reconhecível numa tela de atalho ou num print de acidente.
//
// No banco fica só o SHA-256 hex (users.api_token_hash). Sem sal e sem
// comparação em tempo constante, de propósito: o token tem 256 bits aleatórios,
// então não há dicionário que ataque o hash nem prefixo que um timing revele —
// a busca é um `where hash = $1` comum, pelo índice único.

import { createHash, randomBytes } from "node:crypto";

export const PREFIXO_DO_TOKEN = "fz_";

export function novoTokenDeApi(): string {
  return PREFIXO_DO_TOKEN + randomBytes(32).toString("base64url");
}

export function hashDoToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * O token de um header `Authorization: Bearer <token>`, ou null.
 *
 * Esquema sem distinção de maiúsculas (RFC 9110) e espaços em volta tolerados
 * — o app Atalhos monta o header à mão, e sobrar um espaço é fácil. O que NÃO
 * se tolera é token sem o prefixo da casa: não é nosso, e o 401 sai antes de
 * qualquer consulta.
 */
export function extrairBearer(authorization: string | null | undefined): string | null {
  if (!authorization) return null;
  const partes = authorization.trim().split(/\s+/);
  if (partes.length !== 2 || partes[0].toLowerCase() !== "bearer") return null;
  const token = partes[1];
  return token.startsWith(PREFIXO_DO_TOKEN) && token.length > PREFIXO_DO_TOKEN.length
    ? token
    : null;
}
