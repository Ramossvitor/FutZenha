// A rota que serve a arte dos badges.
//
// Ela é PÚBLICA por construção (não está no matcher do src/proxy.ts), porque o
// badge em destaque aparece em /rankings, /fut/[id] e /grupo/[slug] — telas que
// qualquer um abre. Se um dia ela entrar num prefixo protegido, o sintoma será
// badge quebrado só para quem NÃO está logado, e ninguém descobre isso testando
// logado. Daí este arquivo existir.
//
// Os cabeçalhos também são contrato: o `immutable` só é seguro porque o hash do
// conteúdo está no caminho, e o 404 precisa do `no-store` justamente por isso —
// um 404 cacheado por um ano seria um badge permanentemente quebrado.

import { describe, expect, it } from "vitest";
import { GET } from "@/app/imagens/loja/[id]/[hash]/route";
import { pngDeUmaCor } from "@/test/fixtures-imagem";
import { criarBadge, criarItemDaLoja, criarMoldura } from "@/test/fixtures-loja";

function pedir(id: string | number, hash: string): Promise<Response> {
  return GET(new Request("http://localhost/imagens"), {
    params: Promise.resolve({ id: String(id), hash }),
  });
}

const HASH_VALIDO = "a".repeat(32);

describe("GET /imagens/loja/[id]/[hash]", () => {
  it("devolve os bytes da imagem, com o tipo e o cache certos", async () => {
    const badge = await criarBadge("Avaí", 250);

    const resposta = await pedir(badge.id, badge.imagemHash!);

    expect(resposta.status).toBe(200);
    expect(resposta.headers.get("content-type")).toBe("image/png");
    const corpo = Buffer.from(await resposta.arrayBuffer());
    expect(corpo.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(resposta.headers.get("content-length")).toBe(String(corpo.byteLength));
  });

  // O hash está no caminho, então trocar a arte troca a URL — é o que torna
  // "para sempre" seguro.
  it("a resposta é cacheável para sempre", async () => {
    const badge = await criarBadge("Avaí", 250);

    const cache = (await pedir(badge.id, badge.imagemHash!)).headers.get("cache-control") ?? "";

    expect(cache).toContain("public");
    expect(cache).toContain("immutable");
    expect(cache).toContain("max-age=31536000");
  });

  // Pedir a arte ANTIGA de um item precisa dar 404 — e não a arte nova sob a URL
  // velha, que é como um badge trocado apareceria errado para quem tem a página
  // aberta.
  it("hash que não é o guardado dá 404", async () => {
    const badge = await criarBadge("Avaí", 250);

    const resposta = await pedir(badge.id, HASH_VALIDO);

    expect(resposta.status).toBe(404);
  });

  it("o 404 NÃO pode ser cacheado", async () => {
    const resposta = await pedir(999_999, HASH_VALIDO);

    expect(resposta.status).toBe(404);
    expect(resposta.headers.get("cache-control")).toBe("no-store");
  });

  it("id que não é número não vai ao banco e dá 404", async () => {
    // Os três últimos são inteiros para o JavaScript e lixo para o int4 do
    // Postgres: sem o teto no guard, viravam erro de banco (500) em vez de 404.
    for (const id of [
      "abc",
      "1; drop table loja_itens",
      "-1",
      "0",
      "1.5",
      "2147483648",
      "1e300",
      "100000000000000000000",
    ]) {
      expect((await pedir(id, HASH_VALIDO)).status).toBe(404);
    }
  });

  it("hash fora do formato dá 404", async () => {
    const badge = await criarBadge("Avaí", 250);

    for (const hash of ["", "curto", "A".repeat(32), "../../etc/passwd", "z".repeat(32)]) {
      expect((await pedir(badge.id, hash)).status).toBe(404);
    }
  });

  // Só badge tem imagem — o check `(tipo = 'badge') = (imagem_hash is not null)`
  // garante isso, e a rota não tem o que servir para os outros.
  it("item sem imagem dá 404", async () => {
    const moldura = await criarMoldura("Moldura de ouro", 300);

    expect((await pedir(moldura.id, HASH_VALIDO)).status).toBe(404);
  });

  it("dois badges têm artes e URLs diferentes", async () => {
    const um = await criarBadge("Avaí", 250);
    const outro = await criarBadge("Figueirense", 250);

    expect(um.imagemHash).not.toBe(outro.imagemHash);
    // E o hash de um não abre a imagem do outro: o par (id, hash) é conferido
    // junto no WHERE.
    expect((await pedir(um.id, outro.imagemHash!)).status).toBe(404);
  });

  it("os bytes voltam iguais aos que foram gravados", async () => {
    // A fixture gera a arte a partir da cor do item, então dá para reconstruí-la
    // e comparar byte a byte — é a prova de que nada se perde no bytea.
    const arte = pngDeUmaCor("#123456");
    const badge = await criarItemDaLoja({ tipo: "badge", nome: "Cor fixa", cor: "#123456" });

    const resposta = await pedir(badge.id, badge.imagemHash!);

    expect(Buffer.compare(Buffer.from(await resposta.arrayBuffer()), arte)).toBe(0);
  });
});
