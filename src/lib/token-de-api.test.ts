import { describe, expect, it } from "vitest";
import { extrairBearer, hashDoToken, novoTokenDeApi, PREFIXO_DO_TOKEN } from "./token-de-api";

describe("novoTokenDeApi", () => {
  it("nasce com o prefixo e 32 bytes em base64url", () => {
    const token = novoTokenDeApi();

    expect(token.startsWith(PREFIXO_DO_TOKEN)).toBe(true);
    // 32 bytes em base64url sem padding são 43 caracteres.
    expect(token.slice(PREFIXO_DO_TOKEN.length)).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("nunca repete", () => {
    const vistos = new Set(Array.from({ length: 50 }, () => novoTokenDeApi()));
    expect(vistos.size).toBe(50);
  });
});

describe("hashDoToken", () => {
  it("é SHA-256 em hex, estável para o mesmo token", () => {
    const token = novoTokenDeApi();

    expect(hashDoToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashDoToken(token)).toBe(hashDoToken(token));
    expect(hashDoToken(token)).not.toBe(hashDoToken(novoTokenDeApi()));
  });
});

describe("extrairBearer", () => {
  const token = novoTokenDeApi();

  it("lê o token de um header Bearer", () => {
    expect(extrairBearer(`Bearer ${token}`)).toBe(token);
  });

  it("tolera o esquema em outra caixa e espaços em volta", () => {
    expect(extrairBearer(`  bearer   ${token}  `)).toBe(token);
  });

  it("recusa header ausente, outro esquema ou sem token", () => {
    expect(extrairBearer(null)).toBeNull();
    expect(extrairBearer(undefined)).toBeNull();
    expect(extrairBearer("")).toBeNull();
    expect(extrairBearer(`Basic ${token}`)).toBeNull();
    expect(extrairBearer("Bearer")).toBeNull();
    expect(extrairBearer(`Bearer ${token} extra`)).toBeNull();
  });

  // Token que não é nosso não chega ao banco: o prefixo é a primeira porta.
  it("recusa token sem o prefixo da casa", () => {
    expect(extrairBearer("Bearer abcdef")).toBeNull();
    expect(extrairBearer(`Bearer ${PREFIXO_DO_TOKEN}`)).toBeNull();
  });
});
