// O fluxo automático completo do convite de grupo: action → transação →
// notificação → aviso por email no after(). O efeito do after() só consuma com
// flushAfter() — como no Next real, a action retorna antes de o email sair.

import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { groupInvitations, notifications, type Player } from "@/db/schema";
import { flushAfter } from "@/test/after-flush";
import { criarConta, criarJogador, criarJogadorComConta, logarComo } from "@/test/fixtures";
import { criarConviteDeGrupo, criarGrupo, entrarNoGrupo } from "@/test/fixtures-grupo";
import { esperaNotFound, esperaRedirect } from "@/test/navigation-fake";
import { payloadDoEnvio, stubResend } from "@/test/resend-fake";
import { convidarJogador, reenviarEmailDoConvite } from "./actions";

const EMAIL = "convidado@example.com";

async function grupoComOrganizadorLogado(): Promise<number> {
  const { jogador, conta } = await criarJogadorComConta();
  const groupId = await criarGrupo();
  await entrarNoGrupo(groupId, jogador, "admin");
  await logarComo(conta);
  return groupId;
}

/** Convidado elegível: jogador com conta ativa e email. */
async function criarConvidado(email = EMAIL): Promise<Player> {
  const jogador = await criarJogador();
  await criarConta(jogador, { email });
  return jogador;
}

function formConvite(playerId: number): FormData {
  const form = new FormData();
  form.set("playerId", String(playerId));
  return form;
}

async function lerConvitePendente(groupId: number, playerId: number) {
  const [linha] = await db
    .select()
    .from(groupInvitations)
    .where(
      and(
        eq(groupInvitations.groupId, groupId),
        eq(groupInvitations.playerId, playerId),
        eq(groupInvitations.status, "pending"),
      ),
    );
  return linha;
}

describe("convidarJogador", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("cria convite + notificação e o aviso sai no after()", async () => {
    const groupId = await grupoComOrganizadorLogado();
    const convidado = await criarConvidado();
    const fetchMock = stubResend();

    const url = await esperaRedirect(convidarJogador(groupId, formConvite(convidado.id)));

    expect(url).toBe(`/grupo/${groupId}/gerenciar?ok=convite-enviado`);
    await flushAfter();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(payloadDoEnvio(fetchMock).to).toEqual([EMAIL]);

    const convite = await lerConvitePendente(groupId, convidado.id);
    expect(convite.emailSentAt).not.toBeNull();
    const [notificacao] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.playerId, convidado.id));
    expect(notificacao.dedupeKey).toBe(`grupo:${groupId}:convite:${convite.id}`);
  });

  it("sem RESEND_API_KEY o convite e a notificação existem, mas nada vai à rede", async () => {
    const groupId = await grupoComOrganizadorLogado();
    const convidado = await criarConvidado();
    // Sem stubResend: o fetch-guard do setup estoura se algo tentar sair.

    const url = await esperaRedirect(convidarJogador(groupId, formConvite(convidado.id)));

    expect(url).toBe(`/grupo/${groupId}/gerenciar?ok=convite-enviado`);
    await flushAfter();
    const convite = await lerConvitePendente(groupId, convidado.id);
    expect(convite.emailSentAt).toBeNull();
    const [notificacao] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.playerId, convidado.id));
    expect(notificacao).toBeDefined();
  });

  // O guard do disparo automático é 24h sobre envio de FATO (email_sent_at):
  // revogar-e-reconvidar não vira loop de email na caixa da pessoa…
  it("reconvidar com aviso enviado há menos de 24h não repete o email", async () => {
    const groupId = await grupoComOrganizadorLogado();
    const convidado = await criarConvidado();
    await criarConviteDeGrupo(groupId, convidado, {
      status: "revoked",
      emailEnviadoHaMinutos: 60,
    });
    const fetchMock = stubResend();

    await esperaRedirect(convidarJogador(groupId, formConvite(convidado.id)));

    await flushAfter();
    expect(fetchMock).not.toHaveBeenCalled();
    const convite = await lerConvitePendente(groupId, convidado.id);
    expect(convite.emailSentAt).toBeNull();
  });

  // …mas uma falha de envio (email_sent_at nulo) não custa 24h de bloqueio: só
  // envio consumado conta.
  it("reconvidar após um aviso que nunca saiu envia normalmente", async () => {
    const groupId = await grupoComOrganizadorLogado();
    const convidado = await criarConvidado();
    await criarConviteDeGrupo(groupId, convidado, { status: "revoked" });
    const fetchMock = stubResend();

    await esperaRedirect(convidarJogador(groupId, formConvite(convidado.id)));

    await flushAfter();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reconvidar com o envio anterior a mais de 24h envia de novo", async () => {
    const groupId = await grupoComOrganizadorLogado();
    const convidado = await criarConvidado();
    await criarConviteDeGrupo(groupId, convidado, {
      status: "revoked",
      emailEnviadoHaMinutos: 25 * 60,
    });
    const fetchMock = stubResend();

    await esperaRedirect(convidarJogador(groupId, formConvite(convidado.id)));

    await flushAfter();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const convite = await lerConvitePendente(groupId, convidado.id);
    expect(convite.emailSentAt).not.toBeNull();
  });
});

describe("reenviarEmailDoConvite", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // Toda action que gasta e-mail tem teste de guard (ver o admin de jogadores e
  // a gestão de fut). Aqui pesa mais: quem convida gasta a cota de todo
  // mundo, e o id do convite vem do cliente.
  it("membro comum do grupo é barrado antes de qualquer envio", async () => {
    const groupId = await grupoComOrganizadorLogado();
    const convidado = await criarConvidado();
    const convite = await criarConviteDeGrupo(groupId, convidado);
    const { jogador, conta } = await criarJogadorComConta();
    await entrarNoGrupo(groupId, jogador, "member");
    await logarComo(conta);
    const fetchMock = stubResend();

    await esperaNotFound(reenviarEmailDoConvite(groupId, convite.id));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("quem não é do grupo é barrado antes de qualquer envio", async () => {
    const groupId = await grupoComOrganizadorLogado();
    const convidado = await criarConvidado();
    const convite = await criarConviteDeGrupo(groupId, convidado);
    const { conta } = await criarJogadorComConta();
    await logarComo(conta);
    const fetchMock = stubResend();

    await esperaNotFound(reenviarEmailDoConvite(groupId, convite.id));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reenvia um aviso que não saiu e carimba email_sent_at", async () => {
    const groupId = await grupoComOrganizadorLogado();
    const convidado = await criarConvidado();
    const convite = await criarConviteDeGrupo(groupId, convidado);
    const fetchMock = stubResend();

    const url = await esperaRedirect(reenviarEmailDoConvite(groupId, convite.id));

    expect(url).toBe(`/grupo/${groupId}/gerenciar?ok=convite-enviado-por-email`);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const depois = await lerConvitePendente(groupId, convidado.id);
    expect(depois.emailSentAt).not.toBeNull();
  });

  it("dentro da janela de 10 min devolve o banner de envio recente", async () => {
    const groupId = await grupoComOrganizadorLogado();
    const convidado = await criarConvidado();
    const convite = await criarConviteDeGrupo(groupId, convidado, { emailEnviadoHaMinutos: 5 });
    stubResend();

    const url = await esperaRedirect(reenviarEmailDoConvite(groupId, convite.id));

    expect(url).toBe(`/grupo/${groupId}/gerenciar?erro=email-recente`);
  });

  it("convite de outro grupo devolve o banner de não reenviável", async () => {
    const groupId = await grupoComOrganizadorLogado();
    const outroGrupo = await criarGrupo("Grupo Alheio");
    const convidado = await criarConvidado();
    const conviteAlheio = await criarConviteDeGrupo(outroGrupo, convidado);
    stubResend();

    const url = await esperaRedirect(reenviarEmailDoConvite(groupId, conviteAlheio.id));

    expect(url).toBe(`/grupo/${groupId}/gerenciar?erro=convite-nao-reenviavel`);
  });

  // A rajada persistente atravessa o retry do transporte e chega ao banner com
  // mensagem própria — não a de "limite diário", que mandaria esperar até
  // amanhã por algo que passa em segundos.
  it("rajada persistente no Resend devolve o banner de rajada", async () => {
    const groupId = await grupoComOrganizadorLogado();
    const convidado = await criarConvidado();
    const convite = await criarConviteDeGrupo(groupId, convidado);
    const fetchMock = stubResend({
      status: 429,
      corpo: { name: "rate_limit_exceeded" },
      headers: { "retry-after": "0" },
    });

    const url = await esperaRedirect(reenviarEmailDoConvite(groupId, convite.id));

    expect(url).toBe(`/grupo/${groupId}/gerenciar?erro=email-rajada`);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const depois = await lerConvitePendente(groupId, convidado.id);
    expect(depois.emailSentAt).toBeNull();
  });
});
