import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { MAX_SENHA, MIN_SENHA } from "./regras";

// Hash de senha com scrypt do node:crypto — sem dependências, memory-hard.
// Server Actions rodam no runtime Node; o proxy nunca toca em senha.
// Formato armazenado: scrypt$N$r$p$<salt base64>$<hash base64>

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;

// Hash de uma senha aleatória descartada. Usado no login quando o username não
// existe, para o tempo de resposta não denunciar quais usuários existem.
export const DUMMY_HASH =
  "scrypt$16384$8$1$ngx/lYVxJ3+C528IGBB1ag==$lrfefBsXYK+mv6kcJ+Fzu+eQg31oGBGkhpZoZNGQ9FU6SJhGTAMme+GKiyGqXR8cdNJiiNGMwtOxgwgdM39xpA==";

function scryptAsync(password: string, salt: Buffer, N: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, { N, r, p }, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

/**
 * O que conta como senha aceitável, num lugar só: o resgate de convite e a troca
 * no /perfil pediam a mesma coisa em dois schemas separados.
 *
 * Os números vêm de src/lib/regras.ts, e não daqui, porque os formulários que
 * precisam do `minLength` são Client Components — este módulo importa
 * `node:crypto` e não pode ser alcançado por eles. O porquê do valor está lá.
 */
export const senhaSchema = z
  .string()
  .min(MIN_SENHA, `A senha precisa de pelo menos ${MIN_SENHA} caracteres.`)
  .max(MAX_SENHA, "Senha longa demais.");

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, SCRYPT_N, SCRYPT_R, SCRYPT_P);
  return ["scrypt", SCRYPT_N, SCRYPT_R, SCRYPT_P, salt.toString("base64"), key.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [algo, nRaw, rRaw, pRaw, saltRaw, hashRaw] = stored.split("$");
    const N = Number(nRaw);
    const r = Number(rRaw);
    const p = Number(pRaw);
    if (algo !== "scrypt" || !Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) {
      return false;
    }
    const salt = Buffer.from(saltRaw, "base64");
    const expected = Buffer.from(hashRaw, "base64");
    if (salt.length === 0 || expected.length === 0) return false;
    const key = await scryptAsync(password, salt, N, r, p);
    return key.length === expected.length && timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}
