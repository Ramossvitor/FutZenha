import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { invites } from "@/db/schema";
import { enviarConvitePorEmail } from "@/lib/email-convite";
import { criarConta, criarConvite, criarJogador, criarVolumeDeConvites } from "@/test/fixtures";
import { criarConviteDeGrupo, criarGrupo, criarVolumeDeAvisosDeGrupo } from "@/test/fixtures-grupo";
import { payloadDoEnvio, stubResend } from "@/test/resend-fake";

const EMAIL = "destino@example.com";

async function lerConvite(id: number) {
  const [linha] = await db.select().from(invites).where(eq(invites.id, id));
  return linha;
}

describe("enviarConvitePorEmail", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sem RESEND_API_KEY devolve nao-configurado sem tocar rede nem banco", async () => {
    const jogador = await criarJogador();
    const convite = await criarConvite(jogador, { email: EMAIL });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const selectSpy = vi.spyOn(db, "select");
    const updateSpy = vi.spyOn(db, "update");

    const resultado = await enviarConvitePorEmail(convite.token);

    expect(resultado).toEqual({ ok: false, motivo: "nao-configurado" });
    expect(fetchMock).not.toHaveBeenCalled();
    // Comportamento pinado: sem key o banco nem é consultado (modo preview/dev).
    expect(selectSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
    selectSpy.mockRestore();
    updateSpy.mockRestore();
  });

  describe("elegibilidade", () => {
    it("token inexistente devolve convite-inelegivel sem enviar", async () => {
      const fetchMock = stubResend();

      const resultado = await enviarConvitePorEmail("token-que-nao-existe");

      expect(resultado).toEqual({ ok: false, motivo: "convite-inelegivel" });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("convite já resgatado devolve convite-inelegivel sem enviar", async () => {
      const jogador = await criarJogador();
      const convite = await criarConvite(jogador, { email: EMAIL, usado: true });
      const fetchMock = stubResend();

      const resultado = await enviarConvitePorEmail(convite.token);

      expect(resultado).toEqual({ ok: false, motivo: "convite-inelegivel" });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("convite expirado devolve convite-inelegivel sem enviar", async () => {
      const jogador = await criarJogador();
      const convite = await criarConvite(jogador, { email: EMAIL, expiradoHaMinutos: 60 });
      const fetchMock = stubResend();

      const resultado = await enviarConvitePorEmail(convite.token);

      expect(resultado).toEqual({ ok: false, motivo: "convite-inelegivel" });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("convite sem email (legado de usuário e senha) devolve convite-inelegivel", async () => {
      const jogador = await criarJogador();
      const convite = await criarConvite(jogador);
      const fetchMock = stubResend();

      const resultado = await enviarConvitePorEmail(convite.token);

      expect(resultado).toEqual({ ok: false, motivo: "convite-inelegivel" });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("janela por destinatário", () => {
    it("envio há 5 minutos bloqueia e não re-escreve o carimbo", async () => {
      const jogador = await criarJogador();
      const convite = await criarConvite(jogador, { email: EMAIL, emailEnviadoHaMinutos: 5 });
      const fetchMock = stubResend();

      const resultado = await enviarConvitePorEmail(convite.token);

      expect(resultado).toEqual({ ok: false, motivo: "envio-recente" });
      expect(fetchMock).not.toHaveBeenCalled();
      const depois = await lerConvite(convite.id);
      expect(depois.emailSentAt?.getTime()).toBe(convite.emailSentAt?.getTime());
    });

    it("envio há 11 minutos está fora da janela e envia de novo", async () => {
      const jogador = await criarJogador();
      const convite = await criarConvite(jogador, { email: EMAIL, emailEnviadoHaMinutos: 11 });
      const fetchMock = stubResend();

      const resultado = await enviarConvitePorEmail(convite.token);

      expect(resultado).toEqual({ ok: true });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const depois = await lerConvite(convite.id);
      expect(depois.emailSentAt!.getTime()).toBeGreaterThan(convite.emailSentAt!.getTime());
    });

    // A janela é por caixa de entrada, não por fluxo: o aviso de grupo sai para
    // o e-mail da conta, que é o mesmo endereço deste convite.
    it("aviso de grupo recente para a mesma caixa também bloqueia", async () => {
      const dono = await criarJogador();
      await criarConta(dono, { email: EMAIL });
      const groupId = await criarGrupo();
      await criarConviteDeGrupo(groupId, dono, { emailEnviadoHaMinutos: 5 });
      const alvo = await criarJogador();
      const convite = await criarConvite(alvo, { email: EMAIL });
      const fetchMock = stubResend();

      const resultado = await enviarConvitePorEmail(convite.token);

      expect(resultado).toEqual({ ok: false, motivo: "envio-recente" });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    // Gmail fora da regra @example.com de propósito — é a exceção registrada no
    // AGENTS.md e no cabeçalho de fixtures.ts: a forma canônica (ponto e +tag)
    // só existe para Gmail. Como o domínio deixa de proteger, o local part é um
    // que ninguém registraria; e o caminho é bloqueado ANTES de qualquer fetch,
    // além do kill switch da key e do fetch-guard do setup.
    it("a janela compara a forma canônica: ponto e +tag de Gmail são a mesma caixa", async () => {
      const anterior = await criarJogador();
      await criarConvite(anterior, {
        email: "futzenha.fixture.nao.existe@gmail.com",
        emailEnviadoHaMinutos: 5,
      });
      const alvo = await criarJogador();
      const convite = await criarConvite(alvo, {
        email: "futzenhafixturenaoexiste+festa@gmail.com",
      });
      const fetchMock = stubResend();

      const resultado = await enviarConvitePorEmail(convite.token);

      expect(resultado).toEqual({ ok: false, motivo: "envio-recente" });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("teto diário", () => {
    it("com 90 envios nas últimas 24h devolve limite sem chamar a rede", async () => {
      const volume = await criarJogador();
      await criarVolumeDeConvites(volume, 90, { enviadoHaUmaHora: true });
      const alvo = await criarJogador();
      const convite = await criarConvite(alvo, { email: EMAIL });
      const fetchMock = stubResend();

      const resultado = await enviarConvitePorEmail(convite.token);

      expect(resultado).toEqual({ ok: false, motivo: "limite" });
      expect(fetchMock).not.toHaveBeenCalled();
      const depois = await lerConvite(convite.id);
      expect(depois.emailSentAt).toBeNull();
    });

    it("com 89 envios ainda envia — convite com email_sent_at nulo não conta", async () => {
      const volume = await criarJogador();
      await criarVolumeDeConvites(volume, 89, { enviadoHaUmaHora: true });
      // Se estes nulos contassem, o total passaria de 90 e o envio seria barrado.
      await criarVolumeDeConvites(volume, 5, { enviadoHaUmaHora: false });
      const alvo = await criarJogador();
      const convite = await criarConvite(alvo, { email: EMAIL });
      const fetchMock = stubResend();

      const resultado = await enviarConvitePorEmail(convite.token);

      expect(resultado).toEqual({ ok: true });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("o teto soma os avisos de grupo: 45 + 45 barra o convite de plataforma", async () => {
      const volume = await criarJogador();
      await criarVolumeDeConvites(volume, 45, { enviadoHaUmaHora: true });
      const groupId = await criarGrupo();
      await criarVolumeDeAvisosDeGrupo(groupId, volume, 45);
      const alvo = await criarJogador();
      const convite = await criarConvite(alvo, { email: EMAIL });
      const fetchMock = stubResend();

      const resultado = await enviarConvitePorEmail(convite.token);

      expect(resultado).toEqual({ ok: false, motivo: "limite" });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("modelo do email", () => {
    it("jogador sem conta recebe o convite de plataforma", async () => {
      const jogador = await criarJogador();
      const convite = await criarConvite(jogador, { email: EMAIL });
      const fetchMock = stubResend();

      const resultado = await enviarConvitePorEmail(convite.token);

      expect(resultado).toEqual({ ok: true });
      const payload = payloadDoEnvio(fetchMock);
      expect(payload.to).toEqual([EMAIL]);
      expect(payload.subject).toBe("Seu convite para o FutZenha");
    });

    it("jogador com conta recebe o reset de acesso", async () => {
      const jogador = await criarJogador();
      await criarConta(jogador);
      const convite = await criarConvite(jogador, { email: EMAIL });
      const fetchMock = stubResend();

      const resultado = await enviarConvitePorEmail(convite.token);

      expect(resultado).toEqual({ ok: true });
      expect(payloadDoEnvio(fetchMock).subject).toBe("Redefinir seu acesso ao FutZenha");
    });
  });

  describe("resposta do transporte", () => {
    it("200 devolve ok e carimba email_sent_at", async () => {
      const jogador = await criarJogador();
      const convite = await criarConvite(jogador, { email: EMAIL });
      stubResend(200);

      const resultado = await enviarConvitePorEmail(convite.token);

      expect(resultado).toEqual({ ok: true });
      const depois = await lerConvite(convite.id);
      expect(depois.emailSentAt).not.toBeNull();
    });

    it("500 devolve falha e email_sent_at continua nulo", async () => {
      const jogador = await criarJogador();
      const convite = await criarConvite(jogador, { email: EMAIL });
      stubResend(500);

      const resultado = await enviarConvitePorEmail(convite.token);

      expect(resultado).toEqual({ ok: false, motivo: "falha" });
      const depois = await lerConvite(convite.id);
      expect(depois.emailSentAt).toBeNull();
    });

    // O corpo fake default ({id:"x"}) não tem `name`, então este 429 cai no
    // caso terminal — mesmo tratamento da cota diária/mensal.
    it("429 sem name de rajada devolve limite e email_sent_at continua nulo", async () => {
      const jogador = await criarJogador();
      const convite = await criarConvite(jogador, { email: EMAIL });
      stubResend(429);

      const resultado = await enviarConvitePorEmail(convite.token);

      expect(resultado).toEqual({ ok: false, motivo: "limite" });
      const depois = await lerConvite(convite.id);
      expect(depois.emailSentAt).toBeNull();
    });

    it("429 de cota diária não retenta e devolve limite", async () => {
      const jogador = await criarJogador();
      const convite = await criarConvite(jogador, { email: EMAIL });
      const fetchMock = stubResend({ status: 429, corpo: { name: "daily_quota_exceeded" } });

      const resultado = await enviarConvitePorEmail(convite.token);

      expect(resultado).toEqual({ ok: false, motivo: "limite" });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    // A rajada real (2 req/s do free tier) é passageira: o transporte espera o
    // retry-after e reenvia. O "0" mantém o teste rápido — sobra só o jitter.
    it("429 de rajada seguido de 200 retenta e carimba email_sent_at", async () => {
      const jogador = await criarJogador();
      const convite = await criarConvite(jogador, { email: EMAIL });
      const fetchMock = stubResend(
        {
          status: 429,
          corpo: { name: "rate_limit_exceeded" },
          headers: { "retry-after": "0" },
        },
        200,
      );

      const resultado = await enviarConvitePorEmail(convite.token);

      expect(resultado).toEqual({ ok: true });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const depois = await lerConvite(convite.id);
      expect(depois.emailSentAt).not.toBeNull();
    });
  });
});
