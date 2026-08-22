import { db } from "@/db";
import { lerImagemDoItem } from "@/lib/loja-itens";

// A arte dos badges, servida do banco.
//
// ── Por que fora de /loja ───────────────────────────────────────────────────
//
// Esta rota é PÚBLICA de propósito, e o caminho é o que garante isso: o
// src/proxy.ts exige login em `/loja`, `/perfil` e `/jogador`, e o badge em
// destaque aparece em `/rankings`, `/fut/[id]` e `/grupo/[id]`, que qualquer um
// abre. Uma imagem debaixo de um prefixo protegido viraria um redirect para o
// login no meio de uma página pública — badges quebrados para quem não está
// logado, e ninguém descobriria isso testando logado.
//
// O que se expõe aqui é uma figura que já é pública em cinco telas. Não há nome
// de jogador, preço nem posse na resposta.
//
// ── Por que o hash está no caminho ──────────────────────────────────────────
//
// Ele é o conteúdo (ver `hashDaImagem`), então trocar a arte troca a URL. É o
// que deixa a resposta ser `immutable` por um ano sem risco de alguém ficar
// preso na imagem antiga — e é por isso que o hash entra no `WHERE` da consulta:
// pedir a arte VELHA de um item precisa dar 404, e não a arte nova sob a URL
// velha.

/** Rotas não são cacheadas por default no Next; a linha existe para isso ficar dito. */
export const dynamic = "force-dynamic";

const HASH = /^[0-9a-f]{32}$/;

/** 404 que NÃO pode ficar um ano na CDN — ao contrário da imagem, ele é temporário. */
function naoAchada(): Response {
  return new Response("Not Found", {
    status: 404,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET(_request: Request, ctx: RouteContext<"/imagens/loja/[id]/[hash]">) {
  const { id: idParam, hash } = await ctx.params;
  const id = Number(idParam);
  // O formato do hash é conferido ANTES da consulta: é string vinda da URL, e
  // recusar aqui evita mandar lixo ao banco a cada varredura de robô.
  // O teto é o do `serial` (int4): acima dele o Postgres recusa o PARÂMETRO com
  // erro, não com "não achei" — e uma varredura de robô viraria 500 no log.
  if (!Number.isInteger(id) || id <= 0 || id > 2_147_483_647 || !HASH.test(hash)) {
    return naoAchada();
  }

  const imagem = await lerImagemDoItem(db, id, hash);
  if (!imagem) return naoAchada();

  // Uma cópia, e não uma view sobre o buffer do Buffer: desde o TypeScript 5.7 o
  // `Uint8Array` é genérico no tipo do buffer, e `Buffer.buffer` é
  // `ArrayBufferLike` — que pode ser um `SharedArrayBuffer` e por isso não serve
  // como `BodyInit`. A cópia é de no máximo 200 KB, e a CDN faz isto acontecer
  // raramente (a resposta é `immutable`).
  const corpo = new Uint8Array(imagem.bytes);

  return new Response(corpo, {
    headers: {
      // O mime vem do banco, onde um `check` fecha a lista em png/jpeg/webp — e
      // ele foi gravado a partir dos MAGIC BYTES do arquivo, nunca do que o
      // navegador declarou (ver src/lib/imagem-de-item.ts). O `nosniff` global
      // do next.config.ts fecha o resto.
      "Content-Type": imagem.mime,
      "Content-Length": String(imagem.bytes.byteLength),
      "Cache-Control": "public, max-age=31536000, s-maxage=31536000, immutable",
    },
  });
}
