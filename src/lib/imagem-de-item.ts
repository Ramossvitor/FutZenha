// A imagem do badge: o que o servidor aceita guardar.
//
// Puro (só `node:crypto`) para o vitest unit alcançar cada recusa sem banco e
// sem formulário — é aqui que mora a diferença entre "a loja aceita upload" e
// "a loja aceita qualquer coisa".
//
// ── Por que os magic bytes, e não o `type` do arquivo ───────────────────────
//
// O `File.type` que chega no FormData é o que o NAVEGADOR disse, derivado da
// extensão. Quem posta direto (curl, script, aba velha) escreve o que quiser
// ali. Como estes bytes voltam depois num `Content-Type` que nós mesmos
// servimos, acreditar no remetente seria deixá-lo escolher como o browser de
// todo mundo vai interpretar o arquivo.
//
// SVG e GIF ficam de fora por motivos diferentes, e os dois importam: SVG é
// documento com script dentro (servi-lo da nossa origem é XSS armazenado, e o
// `img-src 'self'` da CSP não salva porque a origem É a nossa), e GIF anima —
// uma vitrine de badges piscando é decisão de produto que ninguém tomou.

import { createHash } from "node:crypto";
// O teto vem do módulo puro, e não daqui: o campo do admin é Client Component e
// este arquivo importa `node:crypto` (ver o docblock da constante).
import { TAMANHO_MAXIMO_DA_IMAGEM } from "./item-da-loja";

export const MIMES_ACEITOS = ["image/png", "image/jpeg", "image/webp"] as const;
export type MimeDeImagem = (typeof MIMES_ACEITOS)[number];

/** Por que a imagem não serve. Cada um é um slug de src/lib/mensagens.ts. */
export type ErroDeImagem =
  /** Não veio arquivo nenhum (ou veio vazio). */
  | "imagem-ausente"
  | "imagem-grande"
  /** Não é PNG, JPEG nem WebP — inclusive quando o nome do arquivo jura que é. */
  | "imagem-invalida";

export type ImagemValidada = {
  bytes: Buffer;
  mime: MimeDeImagem;
  /** O hash do conteúdo. Vai para `loja_itens.imagem_hash` e para a URL. */
  hash: string;
};

const ASSINATURA_PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const ASSINATURA_JPEG = [0xff, 0xd8, 0xff];

function comecaCom(bytes: Uint8Array, assinatura: readonly number[]): boolean {
  if (bytes.length < assinatura.length) return false;
  return assinatura.every((b, i) => bytes[i] === b);
}

function textoEm(bytes: Uint8Array, inicio: number, tamanho: number): string {
  return String.fromCharCode(...bytes.subarray(inicio, inicio + tamanho));
}

/**
 * O formato REAL destes bytes, ou `null` se não for um dos três aceitos.
 *
 * O WebP precisa de duas checagens porque RIFF é um contêiner genérico: os
 * quatro primeiros bytes dizem só "é um RIFF" (áudio, vídeo, o que for), e o
 * formato de verdade está nos bytes 8–11. Conferir só o "RIFF" aceitaria um WAV
 * renomeado, que o browser não desenharia.
 */
export function detectarMime(bytes: Uint8Array): MimeDeImagem | null {
  if (comecaCom(bytes, ASSINATURA_PNG)) return "image/png";
  if (comecaCom(bytes, ASSINATURA_JPEG)) return "image/jpeg";
  if (bytes.length >= 12 && textoEm(bytes, 0, 4) === "RIFF" && textoEm(bytes, 8, 4) === "WEBP") {
    return "image/webp";
  }
  return null;
}

/**
 * O hash do conteúdo: sha256 cortado em 32 caracteres hexadecimais.
 *
 * Cortado porque ele vive numa URL que aparece em toda linha de ranking, e 64
 * caracteres ali são peso sem função — colisão não é ameaça de segurança aqui
 * (o hash não autoriza nada; ele só diz "esta é outra imagem"), e 128 bits
 * seguem sendo absurdamente mais do que o necessário para um punhado de badges.
 *
 * Do conteúdo e não aleatório: reenviar a MESMA imagem não muda a URL, então
 * nenhum cache é invalidado à toa.
 */
export function hashDaImagem(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 32);
}

/**
 * Aceita ou recusa, com o motivo. Nunca lança.
 *
 * A ordem das checagens é a que dá a mensagem mais útil: arquivo vazio é
 * "ausente" (foi o formulário que não mandou nada, não o arquivo que era ruim),
 * tamanho antes de formato porque é o erro que a pessoa consegue corrigir
 * sozinha, e formato por último porque é o que exige explicar quais servem.
 *
 * O caminho sem JavaScript passa por aqui igual: quem manda a foto crua do
 * celular é recusado com texto, não com erro de framework — até o teto de corpo
 * das Server Actions (5 MB, em next.config.ts); acima disso é o Next quem corta,
 * antes de esta função rodar.
 */
export function validarImagem(
  bytes: Uint8Array,
): { ok: true; imagem: ImagemValidada } | { ok: false; erro: ErroDeImagem } {
  if (bytes.length === 0) return { ok: false, erro: "imagem-ausente" };
  if (bytes.length > TAMANHO_MAXIMO_DA_IMAGEM) return { ok: false, erro: "imagem-grande" };

  const mime = detectarMime(bytes);
  if (mime === null) return { ok: false, erro: "imagem-invalida" };

  return { ok: true, imagem: { bytes: Buffer.from(bytes), mime, hash: hashDaImagem(bytes) } };
}
