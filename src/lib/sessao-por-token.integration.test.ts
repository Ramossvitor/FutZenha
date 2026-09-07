// A sessão do relógio contra o banco de verdade: o token resolve a conta com a
// MESMA Session do cookie, e as três decisões que o distinguem do cookie —
// conta desativada mata, token_version não mata, e o cookie não enxerga o
// token — valem de fato.

import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { users } from "@/db/schema";
import { SESSION_COOKIE } from "@/lib/auth";
import { getSession } from "@/lib/session";
import { sessaoPorToken } from "@/lib/sessao-por-token";
import { cookieJar } from "@/test/cookie-store";
import { criarJogadorComConta, criarTokenDeApi } from "@/test/fixtures";

// O stub de env não é limpo pelo clearAllMocks do setup.
afterEach(() => {
  vi.unstubAllEnvs();
});

async function conta(id: number) {
  const [linha] = await db.select().from(users).where(eq(users.id, id));
  return linha;
}

describe("sessaoPorToken", () => {
  it("resolve a conta dona do token, com a mesma Session do cookie", async () => {
    const { jogador, conta: dona } = await criarJogadorComConta();
    const token = await criarTokenDeApi(dona);

    const sessao = await sessaoPorToken(`Bearer ${token}`);

    expect(sessao).toMatchObject({
      userId: dona.id,
      username: dona.username,
      isPlatformAdmin: false,
    });
    expect(sessao?.player.id).toBe(jogador.id);
  });

  it("admin da plataforma pela flag e pela chave-mestra da env var", async () => {
    const porFlag = await criarJogadorComConta({}, { isPlatformAdmin: true });
    const porEnv = await criarJogadorComConta();
    vi.stubEnv("PLATFORM_ADMIN_USERNAMES", porEnv.conta.username);

    const daFlag = await sessaoPorToken(`Bearer ${await criarTokenDeApi(porFlag.conta)}`);
    const daEnv = await sessaoPorToken(`Bearer ${await criarTokenDeApi(porEnv.conta)}`);

    expect(daFlag?.isPlatformAdmin).toBe(true);
    expect(daEnv?.isPlatformAdmin).toBe(true);
  });

  it("token desconhecido, header malformado e header ausente dão null", async () => {
    await criarJogadorComConta();

    expect(await sessaoPorToken(`Bearer fz_${"x".repeat(43)}`)).toBeNull();
    expect(await sessaoPorToken("Bearer abc")).toBeNull();
    expect(await sessaoPorToken(null)).toBeNull();
  });

  it("token revogado deixa de valer", async () => {
    const { conta: dona } = await criarJogadorComConta();
    const token = await criarTokenDeApi(dona);
    await db.update(users).set({ apiTokenHash: null }).where(eq(users.id, dona.id));

    expect(await sessaoPorToken(`Bearer ${token}`)).toBeNull();
  });

  it("conta desativada mata o token sem ninguém apagar o hash", async () => {
    const { conta: dona } = await criarJogadorComConta();
    const token = await criarTokenDeApi(dona);
    await db.update(users).set({ active: false }).where(eq(users.id, dona.id));

    expect(await sessaoPorToken(`Bearer ${token}`)).toBeNull();
    expect((await conta(dona.id)).apiTokenHash).not.toBeNull();
  });

  // O relógio não é sessão: a troca de senha (token_version novo) não o corta.
  it("sobrevive à troca de token_version", async () => {
    const { conta: dona } = await criarJogadorComConta();
    const token = await criarTokenDeApi(dona);
    await db
      .update(users)
      .set({ tokenVersion: dona.tokenVersion + 1 })
      .where(eq(users.id, dona.id));

    expect(await sessaoPorToken(`Bearer ${token}`)).not.toBeNull();
  });

  it("carimba o último uso", async () => {
    const { conta: dona } = await criarJogadorComConta();
    const token = await criarTokenDeApi(dona);
    expect((await conta(dona.id)).apiTokenUsadoEm).toBeNull();

    await sessaoPorToken(`Bearer ${token}`);

    expect((await conta(dona.id)).apiTokenUsadoEm).not.toBeNull();
  });

  // O caminho do cookie não enxerga o token: colado no lugar do cookie de
  // sessão, ele não loga ninguém. (Com o jar vazio o teste passaria em vão —
  // por isso o token vai de fato para o cookie.)
  it("o token não vira sessão de cookie", async () => {
    const { conta: dona } = await criarJogadorComConta();
    const token = await criarTokenDeApi(dona);
    cookieJar.set(SESSION_COOKIE, token);

    expect(await getSession()).toBeNull();
    cookieJar.delete(SESSION_COOKIE);
  });
});
