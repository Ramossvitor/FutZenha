import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { invites, type Player } from "@/db/schema";
import { enviarConvitePorEmail } from "@/lib/email-convite";
import { criarConta, criarConvite, criarJogador } from "@/test/fixtures";

const EMAIL = "destino@example.com";

/** Key fake + Resend fake respondendo `status`; devolve o mock para inspecionar chamadas. */
function stubResend(status = 200): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "x" }), { status }));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("RESEND_API_KEY", "re_test_fake");
  return fetchMock;
}

async function lerConvite(id: number) {
  const [linha] = await db.select().from(invites).where(eq(invites.id, id));
  return linha;
}

/**
 * Volume para o teto diário, inserido DIRETO — nunca via gerarConvite, que
 * apaga a linha anterior do jogador e subcontaria o total.
 */
async function criarVolumeDeConvites(
  jogador: Player,
  quantos: number,
  opcoes: { enviadoHaUmaHora: boolean },
): Promise<void> {
  const lote = randomBytes(4).toString("hex");
  await db.insert(invites).values(
    Array.from({ length: quantos }, (_, i) => ({
      token: randomBytes(32).toString("base64url"),
      playerId: jogador.id,
      email: `volume-${lote}-${i}@example.com`,
      expiresAt: sql`now() + interval '7 days'`,
      emailSentAt: opcoes.enviadoHaUmaHora ? sql`now() - interval '60 minutes'` : null,
    })),
  );
}

function payloadDoEnvio(fetchMock: ReturnType<typeof vi.fn>): {
  to: string[];
  subject: string;
} {
  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return JSON.parse(init.body as string);
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

    it("429 devolve limite e email_sent_at continua nulo", async () => {
      const jogador = await criarJogador();
      const convite = await criarConvite(jogador, { email: EMAIL });
      stubResend(429);

      const resultado = await enviarConvitePorEmail(convite.token);

      expect(resultado).toEqual({ ok: false, motivo: "limite" });
      const depois = await lerConvite(convite.id);
      expect(depois.emailSentAt).toBeNull();
    });
  });
});
