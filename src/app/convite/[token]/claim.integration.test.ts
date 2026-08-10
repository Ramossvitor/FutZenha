import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { invites, users } from "@/db/schema";
import { SESSION_COOKIE } from "@/lib/auth";
import { getSession } from "@/lib/session";
import { cookieJar } from "@/test/cookie-store";
import { criarConvite, criarJogador } from "@/test/fixtures";
import { esperaRedirect } from "@/test/navigation-fake";
import { claimInvite } from "./actions";

const SENHA_NOVA = "senha-nova-123";
const ERRO_CONVITE_INVALIDO =
  "Convite inválido ou expirado. Fala com quem te convidou para gerar outro.";

function formularioDeClaim(
  campos: { username?: string; password?: string; confirm?: string } = {},
): FormData {
  const form = new FormData();
  if (campos.username !== undefined) form.set("username", campos.username);
  form.set("password", campos.password ?? SENHA_NOVA);
  form.set("confirm", campos.confirm ?? campos.password ?? SENHA_NOVA);
  return form;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("claimInvite", () => {
  it("cria a conta, marca o convite como usado e deixa o jogador logado", async () => {
    // Stub próprio por cima do stub do setup só para o assert explícito de que
    // o claim não dispara nenhum HTTP.
    const fetchFake = vi.fn();
    vi.stubGlobal("fetch", fetchFake);

    const jogador = await criarJogador();
    const convite = await criarConvite(jogador);

    const destino = await esperaRedirect(
      claimInvite(convite.token, {}, formularioDeClaim({ username: "novato" })),
    );
    expect(destino).toBe("/");

    const [conta] = await db.select().from(users).where(eq(users.playerId, jogador.id));
    expect(conta).toBeDefined();
    expect(conta.username).toBe("novato");
    expect(conta.passwordHash).not.toBeNull();

    const [conviteDepois] = await db.select().from(invites).where(eq(invites.id, convite.id));
    expect(conviteDepois.usedAt).not.toBeNull();

    expect(cookieJar.has(SESSION_COOKIE)).toBe(true);
    const sessao = await getSession();
    expect(sessao?.userId).toBe(conta.id);
    expect(sessao?.player.id).toBe(jogador.id);

    expect(fetchFake).not.toHaveBeenCalled();
  });

  it("recusa convite já usado sem criar nada", async () => {
    const jogador = await criarJogador();
    const convite = await criarConvite(jogador, { usado: true });

    const resultado = await claimInvite(
      convite.token,
      {},
      formularioDeClaim({ username: "novato" }),
    );

    expect(resultado).toEqual({ error: ERRO_CONVITE_INVALIDO });
    expect(await db.select().from(users)).toHaveLength(0);
    expect(cookieJar.has(SESSION_COOKIE)).toBe(false);
  });

  it("recusa convite expirado sem criar nada", async () => {
    const jogador = await criarJogador();
    const convite = await criarConvite(jogador, { expiradoHaMinutos: 60 });

    const resultado = await claimInvite(
      convite.token,
      {},
      formularioDeClaim({ username: "novato" }),
    );

    expect(resultado).toEqual({ error: ERRO_CONVITE_INVALIDO });
    expect(await db.select().from(users)).toHaveLength(0);
    expect(cookieJar.has(SESSION_COOKIE)).toBe(false);
  });

  it("recusa username listado em PLATFORM_ADMIN_USERNAMES e não queima o convite", async () => {
    vi.stubEnv("PLATFORM_ADMIN_USERNAMES", "chefe,super");
    const jogador = await criarJogador();
    const convite = await criarConvite(jogador);

    const resultado = await claimInvite(
      convite.token,
      {},
      formularioDeClaim({ username: "chefe" }),
    );

    expect(resultado).toEqual({ error: "Esse nome de usuário não está disponível." });
    expect(await db.select().from(users)).toHaveLength(0);
    const [conviteDepois] = await db.select().from(invites).where(eq(invites.id, convite.id));
    expect(conviteDepois.usedAt).toBeNull();
    expect(cookieJar.has(SESSION_COOKIE)).toBe(false);
  });

  it("emailSentAt preenchido não muda o claim; usado uma vez, o convite não vale mais", async () => {
    const jogador = await criarJogador();
    const convite = await criarConvite(jogador, { emailEnviadoHaMinutos: 30 });

    const destino = await esperaRedirect(
      claimInvite(convite.token, {}, formularioDeClaim({ username: "novato" })),
    );
    expect(destino).toBe("/");

    cookieJar.limpar();
    const segundaVez = await claimInvite(
      convite.token,
      {},
      formularioDeClaim({ username: "intruso" }),
    );

    expect(segundaVez).toEqual({ error: ERRO_CONVITE_INVALIDO });
    expect(await db.select().from(users)).toHaveLength(1);
    expect(cookieJar.has(SESSION_COOKIE)).toBe(false);
  });
});
