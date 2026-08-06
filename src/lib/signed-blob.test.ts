import { describe, expect, it } from "vitest";
import {
  assinaturaConfere,
  base64urlDecode,
  base64urlDeBytes,
  base64urlEncode,
  hmacHex,
  signBlob,
  verifyBlob,
} from "./signed-blob";

const SEGREDO = "segredo-de-teste";

describe("base64url", () => {
  it("round-trip com acento e emoji", () => {
    for (const texto of ["", "ascii", "José Antônio", "pelada ⚽ hoje", '{"a":1}']) {
      expect(base64urlDecode(base64urlEncode(texto))).toBe(texto);
    }
  });

  // btoa opera sobre latin1 e lançaria em qualquer caractere acima de 0xFF; é o
  // que quebraria um `next` acentuado vindo da URL no state do OAuth.
  it("não lança em texto fora do latin1", () => {
    expect(() => base64urlEncode("ação ⚽")).not.toThrow();
  });

  it("não emite +, / nem = ", () => {
    // Estes bytes produzem "+" e "/" em base64 comum.
    const codificado = base64urlDeBytes(new Uint8Array([251, 255, 190, 62, 63]));
    expect(codificado).not.toMatch(/[+/=]/);
  });

  it("decodifica sem o padding", () => {
    expect(base64urlDecode(base64urlEncode("ab"))).toBe("ab");
    expect(base64urlDecode(base64urlEncode("abc"))).toBe("abc");
    expect(base64urlDecode(base64urlEncode("abcd"))).toBe("abcd");
  });
});

describe("assinaturaConfere", () => {
  it("compara conteúdo e tamanho", () => {
    expect(assinaturaConfere("abc", "abc")).toBe(true);
    expect(assinaturaConfere("abc", "abd")).toBe(false);
    expect(assinaturaConfere("ab", "abc")).toBe(false);
    expect(assinaturaConfere("", "")).toBe(true);
  });
});

describe("signBlob/verifyBlob", () => {
  it("round-trip devolve o payload cru", async () => {
    const payload = { a: 1, b: "dois", c: [3], d: null };
    expect(await verifyBlob(await signBlob(payload, SEGREDO), SEGREDO)).toEqual(payload);
  });

  it("formato é 'base64url.assinatura-hex'", async () => {
    const token = await signBlob({ a: 1 }, SEGREDO);
    const [codificado, assinatura] = token.split(".");
    expect(token.split(".")).toHaveLength(2);
    expect(JSON.parse(base64urlDecode(codificado))).toEqual({ a: 1 });
    expect(assinatura).toMatch(/^[0-9a-f]{64}$/);
  });

  it("payload adulterado mantendo a assinatura → null", async () => {
    const token = await signBlob({ sub: 1 }, SEGREDO);
    const assinatura = token.slice(token.indexOf(".") + 1);
    expect(await verifyBlob(`${base64urlEncode('{"sub":999}')}.${assinatura}`, SEGREDO)).toBeNull();
  });

  it("assinatura adulterada ou segredo diferente → null", async () => {
    const token = await signBlob({ sub: 1 }, SEGREDO);
    expect(await verifyBlob(token.slice(0, -1) + "0", SEGREDO)).toBeNull();
    expect(await verifyBlob(token, "outro-segredo")).toBeNull();
  });

  it("assinatura válida sobre payload que não é JSON → null", async () => {
    // É o que reprova o formato antigo de cookie, "exp.assinatura".
    const naoJson = base64urlEncode("isto-nao-e-json");
    expect(await verifyBlob(`${naoJson}.${await hmacHex(naoJson, SEGREDO)}`, SEGREDO)).toBeNull();
  });

  it("lixo, vazio e undefined → null", async () => {
    expect(await verifyBlob(undefined, SEGREDO)).toBeNull();
    expect(await verifyBlob("", SEGREDO)).toBeNull();
    expect(await verifyBlob("sem-ponto", SEGREDO)).toBeNull();
    expect(await verifyBlob("a.b", SEGREDO)).toBeNull();
    expect(await verifyBlob("a.b.c", SEGREDO)).toBeNull();
  });
});

describe("separação por kind", () => {
  it("round-trip com o mesmo kind", async () => {
    const token = await signBlob({ a: 1 }, SEGREDO, "x:");
    expect(await verifyBlob(token, SEGREDO, "x:")).toEqual({ a: 1 });
  });

  it("kind diferente, ou nenhum, → null", async () => {
    const token = await signBlob({ a: 1 }, SEGREDO, "x:");
    expect(await verifyBlob(token, SEGREDO, "y:")).toBeNull();
    expect(await verifyBlob(token, SEGREDO)).toBeNull();
    expect(await verifyBlob(await signBlob({ a: 1 }, SEGREDO), SEGREDO, "x:")).toBeNull();
  });

  // O kind entra no que é assinado, não no que trafega: quem lê o token não
  // descobre para que ele foi emitido.
  it("não aparece no token", async () => {
    const token = await signBlob({ a: 1 }, SEGREDO, "sessao-secreta:");
    expect(token).not.toContain("sessao-secreta");
    expect(JSON.parse(base64urlDecode(token.split(".")[0]))).toEqual({ a: 1 });
  });

  // A compatibilidade dos cookies em circulação depende disto: sem kind, o dado
  // assinado é o `encoded` puro, exatamente como antes de o kind existir.
  it("o default não muda a assinatura de antes", async () => {
    const encoded = base64urlEncode(JSON.stringify({ sub: 1, v: 1 }));
    const antigo = `${encoded}.${await hmacHex(encoded, SEGREDO)}`;
    expect(await signBlob({ sub: 1, v: 1 }, SEGREDO)).toBe(antigo);
    expect(await verifyBlob(antigo, SEGREDO)).toEqual({ sub: 1, v: 1 });
  });
});
