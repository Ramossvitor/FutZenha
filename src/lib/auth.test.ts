import { beforeEach, describe, expect, it } from "vitest";
import { createSessionToken, signSessionPayload, verifySessionToken } from "./auth";

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

describe("createSessionToken/verifySessionToken", () => {
  it("round-trip de sessão admin", async () => {
    const payload = await verifySessionToken(await createSessionToken({ role: "admin" }));
    expect(payload).not.toBeNull();
    expect(payload!.role).toBe("admin");
    expect(payload!.sub).toBeNull();
    expect(payload!.exp).toBeGreaterThan(Date.now());
  });

  it("round-trip de sessão player preserva sub e v", async () => {
    const payload = await verifySessionToken(
      await createSessionToken({ role: "player", sub: 42, v: 7 }),
    );
    expect(payload).toEqual({ sub: 42, role: "player", v: 7, exp: payload!.exp });
  });

  it("token expirado → null", async () => {
    const token = await signSessionPayload({
      sub: 1,
      role: "player",
      v: 1,
      exp: Date.now() - 1000,
    });
    expect(await verifySessionToken(token)).toBeNull();
  });

  it("payload adulterado mantendo a assinatura original → null", async () => {
    const token = await createSessionToken({ role: "player", sub: 1, v: 1 });
    const sig = token.slice(token.indexOf(".") + 1);
    const forged = base64urlEncode(
      JSON.stringify({ sub: null, role: "admin", v: 0, exp: Date.now() + 60_000 }),
    );
    expect(await verifySessionToken(`${forged}.${sig}`)).toBeNull();
  });

  it("assinatura adulterada → null", async () => {
    const token = await createSessionToken({ role: "admin" });
    const flipped = token.slice(0, -1) + (token.endsWith("0") ? "1" : "0");
    expect(await verifySessionToken(flipped)).toBeNull();
  });

  it("payload assinado com estrutura inválida → null", async () => {
    const encoded = base64urlEncode(JSON.stringify({ role: "root", exp: Date.now() + 60_000 }));
    const token = `${encoded}.${await hmacHex(encoded, TEST_SECRET)}`;
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
    const token = await createSessionToken({ role: "admin" });
    process.env.SESSION_SECRET = "outro-segredo";
    expect(await verifySessionToken(token)).toBeNull();
  });
});
