import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { invites, players } from "@/db/schema";
import { createPlayer, reenviarConvitePorEmail } from "@/app/admin/(panel)/jogadores/actions";
import { reenviarConviteDaPelada } from "@/app/pelada/[id]/gerenciar/actions";
import {
  confirmarPresenca,
  criarConta,
  criarConvite,
  criarJogador,
  criarJogadorComConta,
  criarPelada,
  logarComo,
} from "@/test/fixtures";
import { esperaNotFound, esperaRedirect } from "@/test/navigation-fake";

const EMAIL = "convidado@example.com";

function stubResend(status = 200): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "x" }), { status }));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("RESEND_API_KEY", "re_test_fake");
  return fetchMock;
}

async function logarComoAdminDaPlataforma(): Promise<void> {
  const { conta } = await criarJogadorComConta({}, { isPlatformAdmin: true });
  await logarComo(conta);
}

function formularioDeJogador(campos: { name: string; email?: string }): FormData {
  const fd = new FormData();
  fd.set("name", campos.name);
  if (campos.email !== undefined) fd.set("email", campos.email);
  return fd;
}

async function conviteDoJogador(playerId: number) {
  return db.select().from(invites).where(eq(invites.playerId, playerId));
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("createPlayer", () => {
  it("com email e envio ok cria jogador e convite e confirma no banner", async () => {
    await logarComoAdminDaPlataforma();
    const fetchMock = stubResend(200);

    const url = await esperaRedirect(
      createPlayer(formularioDeJogador({ name: "Novato", email: EMAIL })),
    );

    expect(url).toBe("/admin/jogadores?ok=convite-enviado-por-email");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [jogador] = await db.select().from(players).where(eq(players.name, "Novato"));
    expect(jogador).toBeDefined();
    const [convite] = await conviteDoJogador(jogador.id);
    expect(convite.email).toBe(EMAIL);
    expect(convite.usedAt).toBeNull();
    expect(convite.emailSentAt).not.toBeNull();
  });

  it("com email e envio falhando mantém jogador e convite (envio fora da transação)", async () => {
    await logarComoAdminDaPlataforma();
    stubResend(500);

    const url = await esperaRedirect(
      createPlayer(formularioDeJogador({ name: "Novato", email: EMAIL })),
    );

    expect(url).toBe("/admin/jogadores?erro=email-nao-enviado");
    const [jogador] = await db.select().from(players).where(eq(players.name, "Novato"));
    expect(jogador).toBeDefined();
    const [convite] = await conviteDoJogador(jogador.id);
    expect(convite.email).toBe(EMAIL);
    expect(convite.emailSentAt).toBeNull();
  });

  it("sem email cadastra com convite sem destinatário e não tenta enviar", async () => {
    await logarComoAdminDaPlataforma();
    const fetchMock = stubResend();

    const url = await esperaRedirect(createPlayer(formularioDeJogador({ name: "Novato" })));

    expect(url).toBe("/admin/jogadores");
    expect(fetchMock).not.toHaveBeenCalled();
    const [jogador] = await db.select().from(players).where(eq(players.name, "Novato"));
    const [convite] = await conviteDoJogador(jogador.id);
    expect(convite.email).toBeNull();
    expect(convite.emailSentAt).toBeNull();
  });

  it("nome duplicado devolve o erro sem criar convite nem enviar email", async () => {
    await logarComoAdminDaPlataforma();
    await criarJogador({ name: "Repetido" });
    const fetchMock = stubResend();

    const url = await esperaRedirect(
      createPlayer(formularioDeJogador({ name: "Repetido", email: EMAIL })),
    );

    expect(url).toBe("/admin/jogadores?erro=nome-duplicado");
    expect(fetchMock).not.toHaveBeenCalled();
    const homonimos = await db.select().from(players).where(eq(players.name, "Repetido"));
    expect(homonimos).toHaveLength(1);
    expect(await db.select().from(invites)).toHaveLength(0);
  });
});

describe("reenviarConvitePorEmail", () => {
  it("reenvia com o mesmo token, sem reemitir", async () => {
    await logarComoAdminDaPlataforma();
    const jogador = await criarJogador();
    const convite = await criarConvite(jogador, { email: EMAIL });
    const fetchMock = stubResend(200);

    const url = await esperaRedirect(reenviarConvitePorEmail(jogador.id));

    expect(url).toBe("/admin/jogadores?ok=convite-enviado-por-email");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const depois = await conviteDoJogador(jogador.id);
    expect(depois).toHaveLength(1);
    expect(depois[0].id).toBe(convite.id);
    expect(depois[0].token).toBe(convite.token);
    expect(depois[0].emailSentAt).not.toBeNull();
  });

  it("convite já usado não é reenviável", async () => {
    await logarComoAdminDaPlataforma();
    const jogador = await criarJogador();
    await criarConvite(jogador, { email: EMAIL, usado: true });
    const fetchMock = stubResend();

    const url = await esperaRedirect(reenviarConvitePorEmail(jogador.id));

    expect(url).toBe("/admin/jogadores?erro=convite-nao-reenviavel");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("dentro da janela de 10 minutos devolve email-recente", async () => {
    await logarComoAdminDaPlataforma();
    const jogador = await criarJogador();
    await criarConvite(jogador, { email: EMAIL, emailEnviadoHaMinutos: 5 });
    const fetchMock = stubResend();

    const url = await esperaRedirect(reenviarConvitePorEmail(jogador.id));

    expect(url).toBe("/admin/jogadores?erro=email-recente");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("logado sem ser admin da plataforma é barrado", async () => {
    const { conta } = await criarJogadorComConta();
    await logarComo(conta);
    const jogador = await criarJogador();
    await criarConvite(jogador, { email: EMAIL });
    const fetchMock = stubResend();

    await esperaNotFound(reenviarConvitePorEmail(jogador.id));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("reenviarConviteDaPelada", () => {
  it("recusa playerId presente só em outra pelada (anti-IDOR)", async () => {
    await logarComoAdminDaPlataforma();
    const peladaAlvo = await criarPelada();
    const outraPelada = await criarPelada();
    const jogador = await criarJogador();
    await criarConvite(jogador, { email: EMAIL });
    await confirmarPresenca(outraPelada, jogador);
    const fetchMock = stubResend();

    const url = await esperaRedirect(reenviarConviteDaPelada(peladaAlvo.id, jogador.id));

    expect(url).toBe(`/pelada/${peladaAlvo.id}/gerenciar?erro=convite-nao-reenviavel`);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("recusa jogador que já tem conta — reset é da plataforma", async () => {
    await logarComoAdminDaPlataforma();
    const pelada = await criarPelada();
    const jogador = await criarJogador();
    await criarConta(jogador);
    await criarConvite(jogador, { email: EMAIL });
    await confirmarPresenca(pelada, jogador);
    const fetchMock = stubResend();

    const url = await esperaRedirect(reenviarConviteDaPelada(pelada.id, jogador.id));

    expect(url).toBe(`/pelada/${pelada.id}/gerenciar?erro=convite-nao-reenviavel`);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("presente nesta pelada e sem conta, envia", async () => {
    await logarComoAdminDaPlataforma();
    const pelada = await criarPelada();
    const jogador = await criarJogador();
    const convite = await criarConvite(jogador, { email: EMAIL });
    await confirmarPresenca(pelada, jogador);
    const fetchMock = stubResend(200);

    const url = await esperaRedirect(reenviarConviteDaPelada(pelada.id, jogador.id));

    expect(url).toBe(`/pelada/${pelada.id}/gerenciar?ok=convite-enviado-por-email`);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [depois] = await db.select().from(invites).where(eq(invites.id, convite.id));
    expect(depois.emailSentAt).not.toBeNull();
  });

  it("quem não administra a pelada é barrado", async () => {
    const { conta } = await criarJogadorComConta();
    await logarComo(conta);
    const criador = await criarJogador();
    const pelada = await criarPelada({ createdByPlayerId: criador.id });
    const jogador = await criarJogador();
    await criarConvite(jogador, { email: EMAIL });
    await confirmarPresenca(pelada, jogador);
    const fetchMock = stubResend();

    await esperaNotFound(reenviarConviteDaPelada(pelada.id, jogador.id));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
