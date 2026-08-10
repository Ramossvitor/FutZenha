import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { users } from "@/db/schema";
import { SESSION_COOKIE, signSessionPayload } from "@/lib/auth";
import { requirePlayer } from "@/lib/require-player";
import { getSession } from "@/lib/session";
import { cookieJar } from "@/test/cookie-store";
import { criarJogadorComConta, logarComo } from "@/test/fixtures";
import { esperaRedirect } from "@/test/navigation-fake";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getSession", () => {
  it("com cookie válido, devolve a sessão do jogador logado", async () => {
    const { jogador, conta } = await criarJogadorComConta();
    await logarComo(conta);

    const sessao = await getSession();
    expect(sessao).not.toBeNull();
    expect(sessao?.userId).toBe(conta.id);
    expect(sessao?.username).toBe(conta.username);
    expect(sessao?.player.id).toBe(jogador.id);
    expect(sessao?.player.name).toBe(jogador.name);
    expect(sessao?.isPlatformAdmin).toBe(false);
  });

  it("devolve isPlatformAdmin=true para conta com a flag no banco", async () => {
    const { conta } = await criarJogadorComConta({}, { isPlatformAdmin: true });
    await logarComo(conta);

    const sessao = await getSession();
    expect(sessao?.isPlatformAdmin).toBe(true);
  });

  it("devolve isPlatformAdmin=true para username em PLATFORM_ADMIN_USERNAMES, mesmo sem flag no banco", async () => {
    const { conta } = await criarJogadorComConta();
    // Maiúsculas e espaços de propósito: a env var é normalizada na leitura.
    vi.stubEnv("PLATFORM_ADMIN_USERNAMES", ` ${conta.username.toUpperCase()} , outra-pessoa`);
    await logarComo(conta);

    const sessao = await getSession();
    expect(sessao?.isPlatformAdmin).toBe(true);
  });

  it("bump de token_version depois do login derruba a sessão", async () => {
    const { conta } = await criarJogadorComConta();
    await logarComo(conta);

    await db
      .update(users)
      .set({ tokenVersion: conta.tokenVersion + 1 })
      .where(eq(users.id, conta.id));

    expect(await getSession()).toBeNull();
  });

  it("conta desativada (users.active=false) devolve null mesmo com cookie válido", async () => {
    const { conta } = await criarJogadorComConta();
    await logarComo(conta);

    await db.update(users).set({ active: false }).where(eq(users.id, conta.id));

    expect(await getSession()).toBeNull();
  });

  it("token com exp no passado devolve null", async () => {
    const { conta } = await criarJogadorComConta();
    const token = await signSessionPayload({
      sub: conta.id,
      v: conta.tokenVersion,
      exp: Date.now() - 1000,
    });
    cookieJar.set(SESSION_COOKIE, token);

    expect(await getSession()).toBeNull();
  });
});

describe("requirePlayer", () => {
  it("sem cookie, redireciona para /login", async () => {
    const url = await esperaRedirect(requirePlayer());
    expect(url).toBe("/login");
  });

  it("com sessão válida, devolve a sessão sem redirecionar", async () => {
    const { conta } = await criarJogadorComConta();
    await logarComo(conta);

    const sessao = await requirePlayer();
    expect(sessao.userId).toBe(conta.id);
  });
});
