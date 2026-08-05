import { describe, expect, it } from "vitest";
import { DUMMY_HASH, hashPassword, verifyPassword } from "./password";

describe("hashPassword/verifyPassword", () => {
  it("gera hash no formato scrypt$N$r$p$salt$hash", async () => {
    const hash = await hashPassword("senha123");
    expect(hash.startsWith("scrypt$16384$8$1$")).toBe(true);
    expect(hash.split("$")).toHaveLength(6);
  });

  it("verifica a senha correta", async () => {
    const hash = await hashPassword("minha senha com espaços é 🔒");
    expect(await verifyPassword("minha senha com espaços é 🔒", hash)).toBe(true);
  });

  it("rejeita senha errada", async () => {
    const hash = await hashPassword("senha123");
    expect(await verifyPassword("senha124", hash)).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
  });

  it("mesma senha duas vezes gera hashes diferentes (salt aleatório)", async () => {
    const [a, b] = await Promise.all([hashPassword("senha123"), hashPassword("senha123")]);
    expect(a).not.toBe(b);
    expect(await verifyPassword("senha123", a)).toBe(true);
    expect(await verifyPassword("senha123", b)).toBe(true);
  });

  it("hash malformado retorna false sem lançar", async () => {
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("x", "bcrypt$2b$10$abc")).toBe(false);
    expect(await verifyPassword("x", "scrypt$nada$8$1$AA==$AA==")).toBe(false);
    expect(await verifyPassword("x", "scrypt$16384$8$1")).toBe(false);
    expect(await verifyPassword("x", "scrypt$16384$8$1$$")).toBe(false);
  });

  it("DUMMY_HASH tem formato válido e não verifica senhas comuns", async () => {
    expect(DUMMY_HASH.startsWith("scrypt$16384$8$1$")).toBe(true);
    expect(await verifyPassword("senha123", DUMMY_HASH)).toBe(false);
    expect(await verifyPassword("", DUMMY_HASH)).toBe(false);
  });
});
