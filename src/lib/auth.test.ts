import { beforeEach, describe, expect, it } from "vitest";
import {
  createSessionToken,
  SESSION_DURATION_MS,
  signSessionPayload,
  verifySessionToken,
} from "./auth";

const TEST_SECRET = "segredo-de-teste";

// Réplica do hmac interno para forjar tokens no formato legado ("exp.assinatura")
// e assinaturas arbitrárias sem exportar o helper do módulo.
async function hmacHex(data: string, secret: string): Promise<string> {
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

function base64urlEncode(data: string): string {
  return btoa(data).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

beforeEach(() => {
  process.env.SESSION_SECRET = TEST_SECRET;
});

/** Assina um payload arbitrário com o secret dos testes. */
async function assinar(payload: unknown): Promise<string> {
  const encoded = base64urlEncode(JSON.stringify(payload));
  return `${encoded}.${await hmacHex(encoded, TEST_SECRET)}`;
}

describe("createSessionToken/verifySessionToken", () => {
  it("round-trip preserva sub e v, e nada mais", async () => {
    const antes = Date.now();
    const payload = await verifySessionToken(await createSessionToken({ sub: 42, v: 7 }));
    // O toEqual exato é a asserção que importa: o cookie não carrega papel, e um
    // campo novo aqui seria permissão viajando num token de 30 dias.
    expect(payload).toEqual({ sub: 42, v: 7, exp: payload!.exp });
    // A janela de 30 dias é o que sustenta a regra "papel se lê do banco, não do
    // cookie" — sem prendê-la, encurtar ou esticar o prazo passaria batido.
    expect(payload!.exp).toBeGreaterThanOrEqual(antes + SESSION_DURATION_MS);
    expect(payload!.exp).toBeLessThanOrEqual(Date.now() + SESSION_DURATION_MS);
  });

  // O modelo antigo tinha um admin sem linha em users, gravado como sub: null.
  // Recusar aqui é o que encerra essas sessões — e o que impede o DAL de montar
  // um `eq(users.id, null)`, que é SQL inválido.
  it("cookie legado de admin (sub null), mesmo bem assinado → null", async () => {
    const token = await assinar({ sub: null, role: "admin", v: 0, exp: Date.now() + 60_000 });
    expect(await verifySessionToken(token)).toBeNull();
  });

  // O outro lado da moeda: os cookies de jogador em circulação ainda têm o
  // `role` do modelo antigo. Recusá-los deslogaria o grupo inteiro à toa.
  it("cookie legado de jogador (com role sobrando) continua válido", async () => {
    const token = await assinar({ sub: 42, role: "player", v: 7, exp: Date.now() + 60_000 });
    const payload = await verifySessionToken(token);
    expect(payload).not.toBeNull();
    expect(payload!.sub).toBe(42);
    expect(payload!.v).toBe(7);
  });

  // Houve um `pa: true` no cookie, e ele saiu porque papel não pertence ao
  // token. Um cookie antigo que ainda o carregue continua válido — o campo é
  // ignorado, e não concede nada: getSession relê a flag do banco.
  it("cookie legado com pa é aceito, mas o campo não sobrevive ao parse", async () => {
    const token = await assinar({ sub: 42, v: 7, pa: true, exp: Date.now() + 60_000 });
    const payload = await verifySessionToken(token);
    expect(payload).not.toBeNull();
    expect(payload!.sub).toBe(42);
    expect("pa" in payload!).toBe(false);
  });

  it("token expirado → null", async () => {
    const token = await signSessionPayload({ sub: 1, v: 1, exp: Date.now() - 1000 });
    expect(await verifySessionToken(token)).toBeNull();
  });

  it("payload adulterado mantendo a assinatura original → null", async () => {
    const token = await createSessionToken({ sub: 1, v: 1 });
    const sig = token.slice(token.indexOf(".") + 1);
    const forged = base64urlEncode(
      JSON.stringify({ sub: 999, v: 1, exp: Date.now() + 60_000 }),
    );
    expect(await verifySessionToken(`${forged}.${sig}`)).toBeNull();
  });

  it("assinatura adulterada → null", async () => {
    const token = await createSessionToken({ sub: 1, v: 1 });
    const flipped = token.slice(0, -1) + (token.endsWith("0") ? "1" : "0");
    expect(await verifySessionToken(flipped)).toBeNull();
  });

  it("sub ausente, string ou null → null", async () => {
    const exp = Date.now() + 60_000;
    expect(await verifySessionToken(await assinar({ v: 1, exp }))).toBeNull();
    expect(await verifySessionToken(await assinar({ sub: "42", v: 1, exp }))).toBeNull();
    expect(await verifySessionToken(await assinar({ sub: null, v: 1, exp }))).toBeNull();
  });

  // `v` é o que permite revogar uma sessão: o DAL compara com users.token_version
  // e derruba o cookie antigo quando a senha muda ou o papel de admin é mexido.
  // Um `v` não numérico tem de reprovar aqui, não lá adiante.
  it("v ausente ou string → null", async () => {
    const exp = Date.now() + 60_000;
    expect(await verifySessionToken(await assinar({ sub: 1, exp }))).toBeNull();
    expect(await verifySessionToken(await assinar({ sub: 1, v: "7", exp }))).toBeNull();
  });

  it("payload assinado com estrutura inválida → null", async () => {
    const token = await assinar({ role: "root", exp: Date.now() + 60_000 });
    expect(await verifySessionToken(token)).toBeNull();
  });

  it("formato legado ('exp.assinatura') mesmo com secret correto → null", async () => {
    const exp = String(Date.now() + 60_000);
    const legacy = `${exp}.${await hmacHex(exp, TEST_SECRET)}`;
    expect(await verifySessionToken(legacy)).toBeNull();
  });

  it("lixo, vazio e undefined → null", async () => {
    expect(await verifySessionToken(undefined)).toBeNull();
    expect(await verifySessionToken("")).toBeNull();
    expect(await verifySessionToken("sem-ponto")).toBeNull();
    expect(await verifySessionToken("a.b")).toBeNull();
    expect(await verifySessionToken("a.b.c")).toBeNull();
  });

  it("token assinado com outro secret → null", async () => {
    const token = await createSessionToken({ sub: 1, v: 1 });
    process.env.SESSION_SECRET = "outro-segredo";
    expect(await verifySessionToken(token)).toBeNull();
  });
});
