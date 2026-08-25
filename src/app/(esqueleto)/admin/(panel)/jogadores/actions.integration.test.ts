import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { invites, players, users } from "@/db/schema";
import {
  createPlayer,
  definirEmailDeContato,
  reenviarConvitePorEmail,
} from "@/app/(esqueleto)/admin/(panel)/jogadores/actions";
import { reenviarConviteDoFut } from "@/app/(esqueleto)/fut/[id]/gerenciar/actions";
import {
  confirmarPresenca,
  criarConta,
  criarConvite,
  criarJogador,
  criarJogadorComConta,
  criarFut,
  logarComo,
} from "@/test/fixtures";
import { esperaNotFound, esperaRedirect } from "@/test/navigation-fake";
import { stubResend } from "@/test/resend-fake";

const EMAIL = "convidado@example.com";

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

function formularioDeContato(email: string): FormData {
  const fd = new FormData();
  fd.set("contactEmail", email);
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

describe("definirEmailDeContato", () => {
  it("grava o endereço normalizado sem tocar na coluna de login", async () => {
    await logarComoAdminDaPlataforma();
    const { conta } = await criarJogadorComConta({}, { username: "alvo" });

    await definirEmailDeContato(conta.id, formularioDeContato(" Alvo@Example.COM "));

    const [depois] = await db.select().from(users).where(eq(users.id, conta.id));
    expect(depois.contactEmail).toBe("alvo@example.com");
    // Um admin digitando aqui não pode promover um palpite a credencial: quem
    // escreve em `email` é só o retorno verificado do Google.
    expect(depois.email).toBeNull();
    expect(depois.tokenVersion).toBe(conta.tokenVersion);
  });

  it("campo em branco limpa o endereço", async () => {
    await logarComoAdminDaPlataforma();
    const { conta } = await criarJogadorComConta(
      {},
      { username: "alvo", contactEmail: "errado@example.com" },
    );

    await definirEmailDeContato(conta.id, formularioDeContato(""));

    const [depois] = await db.select().from(users).where(eq(users.id, conta.id));
    expect(depois.contactEmail).toBeNull();
  });

  it("endereço inválido volta com o slug próprio e não grava", async () => {
    await logarComoAdminDaPlataforma();
    const { conta } = await criarJogadorComConta({}, { username: "alvo" });

    const url = await esperaRedirect(
      definirEmailDeContato(conta.id, formularioDeContato("sem-arroba")),
    );

    expect(url).toBe("/admin/jogadores?erro=email-contato-invalido");
    const [depois] = await db.select().from(users).where(eq(users.id, conta.id));
    expect(depois.contactEmail).toBeNull();
  });

  it("logado sem ser admin da plataforma é barrado", async () => {
    const { conta } = await criarJogadorComConta();
    await logarComo(conta);
    const { conta: alvo } = await criarJogadorComConta({}, { username: "alvo" });

    await esperaNotFound(definirEmailDeContato(alvo.id, formularioDeContato("x@example.com")));

    const [depois] = await db.select().from(users).where(eq(users.id, alvo.id));
    expect(depois.contactEmail).toBeNull();
  });
});

describe("reenviarConviteDoFut", () => {
  it("recusa playerId presente só em outro fut (anti-IDOR)", async () => {
    await logarComoAdminDaPlataforma();
    const futAlvo = await criarFut();
    const outroFut = await criarFut();
    const jogador = await criarJogador();
    await criarConvite(jogador, { email: EMAIL });
    await confirmarPresenca(outroFut, jogador);
    const fetchMock = stubResend();

    const url = await esperaRedirect(reenviarConviteDoFut(futAlvo.id, jogador.id));

    expect(url).toBe(`/fut/${futAlvo.id}/gerenciar?erro=convite-nao-reenviavel`);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("recusa jogador que já tem conta — reset é da plataforma", async () => {
    await logarComoAdminDaPlataforma();
    const fut = await criarFut();
    const jogador = await criarJogador();
    await criarConta(jogador);
    await criarConvite(jogador, { email: EMAIL });
    await confirmarPresenca(fut, jogador);
    const fetchMock = stubResend();

    const url = await esperaRedirect(reenviarConviteDoFut(fut.id, jogador.id));

    expect(url).toBe(`/fut/${fut.id}/gerenciar?erro=convite-nao-reenviavel`);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("presente neste fut e sem conta, envia", async () => {
    await logarComoAdminDaPlataforma();
    const fut = await criarFut();
    const jogador = await criarJogador();
    const convite = await criarConvite(jogador, { email: EMAIL });
    await confirmarPresenca(fut, jogador);
    const fetchMock = stubResend(200);

    const url = await esperaRedirect(reenviarConviteDoFut(fut.id, jogador.id));

    expect(url).toBe(`/fut/${fut.id}/gerenciar?ok=convite-enviado-por-email`);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [depois] = await db.select().from(invites).where(eq(invites.id, convite.id));
    expect(depois.emailSentAt).not.toBeNull();
  });

  it("quem não administra o fut é barrado", async () => {
    const { conta } = await criarJogadorComConta();
    await logarComo(conta);
    const criador = await criarJogador();
    const fut = await criarFut({ createdByPlayerId: criador.id });
    const jogador = await criarJogador();
    await criarConvite(jogador, { email: EMAIL });
    await confirmarPresenca(fut, jogador);
    const fetchMock = stubResend();

    await esperaNotFound(reenviarConviteDoFut(fut.id, jogador.id));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
