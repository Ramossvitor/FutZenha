import { describe, expect, it } from "vitest";
import { pngDeUmaCor } from "@/test/fixtures-imagem";
import { MIMES_ACEITOS, detectarMime, hashDaImagem, validarImagem } from "./imagem-de-item";
import { TAMANHO_MAXIMO_DA_IMAGEM } from "./item-da-loja";

// Cabeçalhos soltos bastam para exercitar a DETECÇÃO: ela lê os primeiros bytes
// e mais nada. Onde o teste precisa de um arquivo que um decodificador aceite
// (o seed, o E2E), quem entrega é `pngDeUmaCor`.
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const webp = Buffer.concat([
  Buffer.from("RIFF", "latin1"),
  Buffer.from([0x1a, 0x00, 0x00, 0x00]),
  Buffer.from("WEBPVP8 ", "latin1"),
]);
const gif = Buffer.from("GIF89a\0\0\0\0", "latin1");
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>', "latin1");

describe("detectarMime", () => {
  it("reconhece os três formatos aceitos", () => {
    expect(detectarMime(pngDeUmaCor("#4ade80"))).toBe("image/png");
    expect(detectarMime(jpeg)).toBe("image/jpeg");
    expect(detectarMime(webp)).toBe("image/webp");
  });

  it("todo mime devolvido está na lista fechada — o check do banco carrega a mesma", () => {
    for (const bytes of [pngDeUmaCor("#000000"), jpeg, webp]) {
      expect(MIMES_ACEITOS).toContain(detectarMime(bytes));
    }
  });

  it("recusa SVG: é documento com script, e serví-lo da nossa origem é XSS guardado", () => {
    expect(detectarMime(svg)).toBeNull();
  });

  it("recusa GIF: anima, e vitrine de badge piscando ninguém decidiu", () => {
    expect(detectarMime(gif)).toBeNull();
  });

  it("RIFF que não é WEBP não passa — o contêiner sozinho não diz nada", () => {
    const wav = Buffer.concat([
      Buffer.from("RIFF", "latin1"),
      Buffer.from([0x1a, 0x00, 0x00, 0x00]),
      Buffer.from("WAVEfmt ", "latin1"),
    ]);
    expect(detectarMime(wav)).toBeNull();
  });

  it("bytes curtos demais não estouram — devolvem null", () => {
    expect(detectarMime(new Uint8Array())).toBeNull();
    expect(detectarMime(Buffer.from([0x89, 0x50]))).toBeNull();
    expect(detectarMime(Buffer.from("RIFF", "latin1"))).toBeNull();
  });

  it("assinatura quase certa não passa", () => {
    const quase = Buffer.from(pngDeUmaCor("#ffffff"));
    quase[7] = 0x00; // último byte da assinatura do PNG
    expect(detectarMime(quase)).toBeNull();
  });
});

describe("hashDaImagem", () => {
  it("são 32 caracteres hexadecimais — o que a rota da imagem aceita no caminho", () => {
    expect(hashDaImagem(pngDeUmaCor("#123456"))).toMatch(/^[0-9a-f]{32}$/);
  });

  it("o mesmo conteúdo dá o mesmo hash: reenviar a mesma arte não invalida cache", () => {
    expect(hashDaImagem(pngDeUmaCor("#123456"))).toBe(hashDaImagem(pngDeUmaCor("#123456")));
  });

  it("conteúdo diferente dá hash diferente — é o que troca a URL e vence o cache", () => {
    expect(hashDaImagem(pngDeUmaCor("#123456"))).not.toBe(hashDaImagem(pngDeUmaCor("#654321")));
  });
});

describe("validarImagem", () => {
  it("aceita PNG e devolve mime, hash e os bytes", () => {
    const bytes = pngDeUmaCor("#4ade80");
    const resultado = validarImagem(bytes);
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.imagem.mime).toBe("image/png");
    expect(resultado.imagem.hash).toBe(hashDaImagem(bytes));
    expect(Buffer.compare(resultado.imagem.bytes, bytes)).toBe(0);
  });

  it("arquivo vazio é 'ausente', e não 'inválido': quem falhou foi o formulário", () => {
    const resultado = validarImagem(new Uint8Array());
    expect(resultado).toEqual({ ok: false, erro: "imagem-ausente" });
  });

  it("um byte acima do teto é recusado", () => {
    const gordo = Buffer.concat([
      pngDeUmaCor("#000000"),
      Buffer.alloc(TAMANHO_MAXIMO_DA_IMAGEM + 1),
    ]);
    expect(validarImagem(gordo)).toEqual({ ok: false, erro: "imagem-grande" });
  });

  it("no teto exato ainda passa", () => {
    // PNG legítimo, esticado até o limite com bytes depois do IEND. O que se
    // mede aqui é a fronteira do `>`, não a saúde do arquivo.
    const base = pngDeUmaCor("#000000");
    const noLimite = Buffer.concat([base, Buffer.alloc(TAMANHO_MAXIMO_DA_IMAGEM - base.length)]);
    expect(noLimite).toHaveLength(TAMANHO_MAXIMO_DA_IMAGEM);
    expect(validarImagem(noLimite).ok).toBe(true);
  });

  it("o tamanho é conferido antes do formato — é o erro que dá para consertar sozinho", () => {
    const gordoEInvalido = Buffer.concat([gif, Buffer.alloc(TAMANHO_MAXIMO_DA_IMAGEM)]);
    expect(validarImagem(gordoEInvalido)).toEqual({ ok: false, erro: "imagem-grande" });
  });

  it("SVG e GIF são recusados por formato", () => {
    expect(validarImagem(svg)).toEqual({ ok: false, erro: "imagem-invalida" });
    expect(validarImagem(gif)).toEqual({ ok: false, erro: "imagem-invalida" });
  });

  it("o que vale são os BYTES: nome e type do arquivo não entram na conta", () => {
    // Este é o ponto do módulo inteiro. O `File.type` é o que o navegador (ou
    // quem postou direto) DISSE; se ele mandasse no resultado, o remetente
    // escolheria o Content-Type que a nossa rota devolve para todo mundo.
    const mentiroso = new File([new Uint8Array(gif)], "badge.png", { type: "image/png" });
    expect(mentiroso.type).toBe("image/png");
    expect(validarImagem(gif)).toEqual({ ok: false, erro: "imagem-invalida" });
  });

  it("os bytes devolvidos são cópia, e não uma view do buffer de quem chamou", () => {
    const original = pngDeUmaCor("#abcdef");
    const resultado = validarImagem(original);
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    original[10] = 0xff;
    expect(resultado.imagem.bytes[10]).not.toBe(0xff);
  });
});

describe("pngDeUmaCor (a fixture)", () => {
  it("é um PNG de verdade, e não bytes com cara de PNG", async () => {
    // A prova barata de que os chunks estão certos: o IDAT infla de volta para
    // as linhas que foram codificadas (byte de filtro + a cor repetida). Se o
    // CRC ou o tamanho do chunk estivessem errados, é aqui que apareceria.
    const { inflateSync } = await import("node:zlib");
    const lado = 4;
    const png = pngDeUmaCor("#0a1b2c", lado);

    const tamanhoIhdr = png.readUInt32BE(8);
    const inicioIdat = 8 + 4 + 4 + tamanhoIhdr + 4;
    expect(png.subarray(inicioIdat + 4, inicioIdat + 8).toString("latin1")).toBe("IDAT");

    const tamanhoIdat = png.readUInt32BE(inicioIdat);
    const cru = inflateSync(png.subarray(inicioIdat + 8, inicioIdat + 8 + tamanhoIdat));
    expect(cru).toHaveLength(lado * (1 + lado * 3));
    expect(cru[0]).toBe(0); // filtro da primeira linha
    expect([cru[1], cru[2], cru[3]]).toEqual([0x0a, 0x1b, 0x2c]);
    expect(png.subarray(png.length - 8, png.length - 4).toString("latin1")).toBe("IEND");
  });

  it("cabe folgado no teto do upload", () => {
    expect(pngDeUmaCor("#4ade80").length).toBeLessThan(TAMANHO_MAXIMO_DA_IMAGEM);
  });

  it("recusa cor fora do formato em vez de gerar arte errada em silêncio", () => {
    expect(() => pngDeUmaCor("verde")).toThrow(/Cor inválida/);
  });
});
