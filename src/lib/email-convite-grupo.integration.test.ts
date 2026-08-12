import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { groupInvitations, users, type Player } from "@/db/schema";
import { reenviarAvisoDeGrupo } from "@/lib/email-convite";
import { criarConta, criarConvite, criarJogador, criarVolumeDeConvites } from "@/test/fixtures";
import {
  criarConviteDeGrupo,
  criarGrupo,
  criarVolumeDeAvisosDeGrupo,
} from "@/test/fixtures-grupo";
import { payloadDoEnvio, stubResend } from "@/test/resend-fake";

const EMAIL = "convidado@example.com";

/** Convidado elegível: jogador com conta ativa e email. */
async function criarConvidado(email = EMAIL): Promise<Player> {
  const jogador = await criarJogador();
  await criarConta(jogador, { email });
  return jogador;
}

async function lerConviteDeGrupo(id: number) {
  const [linha] = await db.select().from(groupInvitations).where(eq(groupInvitations.id, id));
  return linha;
}

describe("reenviarAvisoDeGrupo", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sem RESEND_API_KEY devolve nao-configurado sem tocar a rede", async () => {
    const groupId = await criarGrupo();
    const convidado = await criarConvidado();
    const convite = await criarConviteDeGrupo(groupId, convidado);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const resultado = await reenviarAvisoDeGrupo(groupId, convite.id);

    expect(resultado).toEqual({ ok: false, motivo: "nao-configurado" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("convite pendente com conta ativa envia, com o nome do grupo e de quem convidou", async () => {
    const groupId = await criarGrupo("Pelada de Quinta");
    const convidado = await criarConvidado();
    const convidante = await criarJogador({ name: "Fulano Convidante" });
    const convite = await criarConviteDeGrupo(groupId, convidado, { convidadoPor: convidante });
    const fetchMock = stubResend();

    const resultado = await reenviarAvisoDeGrupo(groupId, convite.id);

    expect(resultado).toEqual({ ok: true });
    const payload = payloadDoEnvio(fetchMock);
    expect(payload.to).toEqual([EMAIL]);
    expect(payload.subject).toBe("Convite para o grupo Pelada de Quinta no FutZenha");
    expect(payload.text).toContain("Fulano Convidante");
    const depois = await lerConviteDeGrupo(convite.id);
    expect(depois.emailSentAt).not.toBeNull();
  });

  // A FK de quem convidou é set null (a pessoa pode ter sido apagada) — o texto
  // não pode quebrar nem sair com buraco.
  it("convidante apagado vira 'Alguém do grupo' no texto", async () => {
    const groupId = await criarGrupo();
    const convidado = await criarConvidado();
    const convite = await criarConviteDeGrupo(groupId, convidado);
    const fetchMock = stubResend();

    const resultado = await reenviarAvisoDeGrupo(groupId, convite.id);

    expect(resultado).toEqual({ ok: true });
    expect(payloadDoEnvio(fetchMock).text).toContain("Alguém do grupo");
  });

  describe("elegibilidade", () => {
    it("convite revogado devolve convite-inelegivel sem enviar", async () => {
      const groupId = await criarGrupo();
      const convidado = await criarConvidado();
      const convite = await criarConviteDeGrupo(groupId, convidado, { status: "revoked" });
      const fetchMock = stubResend();

      const resultado = await reenviarAvisoDeGrupo(groupId, convite.id);

      expect(resultado).toEqual({ ok: false, motivo: "convite-inelegivel" });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    // O id vem do cliente no reenvio manual: sem o escopo pelo grupo, o
    // organizador de um grupo dispararia email pelo convite de outro.
    it("convite de outro grupo devolve convite-inelegivel", async () => {
      const grupoA = await criarGrupo("Grupo A");
      const grupoB = await criarGrupo("Grupo B");
      const convidado = await criarConvidado();
      const conviteDeB = await criarConviteDeGrupo(grupoB, convidado);
      const fetchMock = stubResend();

      const resultado = await reenviarAvisoDeGrupo(grupoA, conviteDeB.id);

      expect(resultado).toEqual({ ok: false, motivo: "convite-inelegivel" });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("convidado sem conta devolve convite-inelegivel", async () => {
      const groupId = await criarGrupo();
      const semConta = await criarJogador();
      const convite = await criarConviteDeGrupo(groupId, semConta);
      const fetchMock = stubResend();

      const resultado = await reenviarAvisoDeGrupo(groupId, convite.id);

      expect(resultado).toEqual({ ok: false, motivo: "convite-inelegivel" });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    // O motivo de tudo isto existir: quem se cadastrou por usuário e senha só
    // tem o endereço de contato, e antes caía aqui em convite-inelegivel — o
    // aviso simplesmente não saía, sem ninguém perceber.
    it("conta só com e-mail de contato recebe o aviso", async () => {
      const groupId = await criarGrupo();
      const jogador = await criarJogador();
      await criarConta(jogador, { contactEmail: "so-contato@example.com" });
      const convite = await criarConviteDeGrupo(groupId, jogador);
      const fetchMock = stubResend();

      const resultado = await reenviarAvisoDeGrupo(groupId, convite.id);

      expect(resultado).toEqual({ ok: true });
      expect(payloadDoEnvio(fetchMock).to).toEqual(["so-contato@example.com"]);
    });

    // Precedência, não substituição: o verificado vence, senão um contato
    // digitado depois desviaria o correio de uma conta com endereço provado.
    it("com os dois endereços, manda para o do Google", async () => {
      const groupId = await criarGrupo();
      const jogador = await criarJogador();
      await criarConta(jogador, { email: EMAIL, contactEmail: "outro@example.com" });
      const convite = await criarConviteDeGrupo(groupId, jogador);
      const fetchMock = stubResend();

      await reenviarAvisoDeGrupo(groupId, convite.id);

      expect(payloadDoEnvio(fetchMock).to).toEqual([EMAIL]);
    });

    it("conta sem endereço nenhum continua inelegível", async () => {
      const groupId = await criarGrupo();
      const jogador = await criarJogador();
      await criarConta(jogador);
      const convite = await criarConviteDeGrupo(groupId, jogador);
      const fetchMock = stubResend();

      const resultado = await reenviarAvisoDeGrupo(groupId, convite.id);

      expect(resultado).toEqual({ ok: false, motivo: "convite-inelegivel" });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("conta desativada devolve convite-inelegivel", async () => {
      const groupId = await criarGrupo();
      const jogador = await criarJogador();
      await criarConta(jogador, { email: EMAIL, active: false });
      const convite = await criarConviteDeGrupo(groupId, jogador);
      const fetchMock = stubResend();

      const resultado = await reenviarAvisoDeGrupo(groupId, convite.id);

      expect(resultado).toEqual({ ok: false, motivo: "convite-inelegivel" });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("janela por destinatário (10 min no reenvio manual)", () => {
    it("aviso enviado há 5 minutos bloqueia e não re-escreve o carimbo", async () => {
      const groupId = await criarGrupo();
      const convidado = await criarConvidado();
      const convite = await criarConviteDeGrupo(groupId, convidado, { emailEnviadoHaMinutos: 5 });
      const fetchMock = stubResend();

      const resultado = await reenviarAvisoDeGrupo(groupId, convite.id);

      expect(resultado).toEqual({ ok: false, motivo: "envio-recente" });
      expect(fetchMock).not.toHaveBeenCalled();
      const depois = await lerConviteDeGrupo(convite.id);
      expect(depois.emailSentAt?.getTime()).toBe(convite.emailSentAt?.getTime());
    });

    it("aviso enviado há 11 minutos está fora da janela e envia de novo", async () => {
      const groupId = await criarGrupo();
      const convidado = await criarConvidado();
      const convite = await criarConviteDeGrupo(groupId, convidado, { emailEnviadoHaMinutos: 11 });
      const fetchMock = stubResend();

      const resultado = await reenviarAvisoDeGrupo(groupId, convite.id);

      expect(resultado).toEqual({ ok: true });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    // O dedupe olha QUALQUER linha do par (grupo, jogador), não só a atual:
    // revogar-e-reconvidar não zera a janela.
    it("o envio de um convite anterior do mesmo par também conta", async () => {
      const groupId = await criarGrupo();
      const convidado = await criarConvidado();
      await criarConviteDeGrupo(groupId, convidado, {
        status: "revoked",
        emailEnviadoHaMinutos: 5,
      });
      const atual = await criarConviteDeGrupo(groupId, convidado);
      const fetchMock = stubResend();

      const resultado = await reenviarAvisoDeGrupo(groupId, atual.id);

      expect(resultado).toEqual({ ok: false, motivo: "envio-recente" });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  // Acima do dedupe por par vem a janela por destinatário, que é global. É ela
  // que fecha o contorno: criar um grupo novo estreia um par novo, mas a caixa
  // de entrada do outro lado continua sendo a mesma.
  describe("janela por destinatário (global, atravessa grupo e fluxo)", () => {
    it("aviso recente para a mesma caixa em outro grupo bloqueia", async () => {
      const convidado = await criarConvidado();
      const grupoA = await criarGrupo("Grupo A");
      await criarConviteDeGrupo(grupoA, convidado, { emailEnviadoHaMinutos: 5 });
      const grupoB = await criarGrupo("Grupo B");
      const convite = await criarConviteDeGrupo(grupoB, convidado);
      const fetchMock = stubResend();

      const resultado = await reenviarAvisoDeGrupo(grupoB, convite.id);

      expect(resultado).toEqual({ ok: false, motivo: "envio-recente" });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    // O endereço de contato precisa contar na janela igual ao verificado: é o
    // mais fácil de apontar para um terceiro (ninguém o verifica), então deixá-lo
    // de fora do freio seria abrir justamente a porta que o freio fecha.
    it("a janela também vale para quem só tem e-mail de contato", async () => {
      const jogador = await criarJogador();
      await criarConta(jogador, { contactEmail: "so-contato@example.com" });
      const grupoA = await criarGrupo("Grupo A");
      await criarConviteDeGrupo(grupoA, jogador, { emailEnviadoHaMinutos: 5 });
      const grupoB = await criarGrupo("Grupo B");
      const convite = await criarConviteDeGrupo(grupoB, jogador);
      const fetchMock = stubResend();

      const resultado = await reenviarAvisoDeGrupo(grupoB, convite.id);

      expect(resultado).toEqual({ ok: false, motivo: "envio-recente" });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    // O buraco que `email_sent_to` fecha. A janela lia a conta ao vivo, e
    // contact_email é reescrito por qualquer um num request: bastava trocá-lo
    // depois de receber para a linha carimbada parar de resolver para aquela
    // caixa, e uma segunda conta apontada para ela entrava dentro da janela.
    // Agora quem manda registra para onde mandou, e trocar o campo depois não
    // reescreve o passado.
    it("trocar o contato depois do envio não reabre a janela para a mesma caixa", async () => {
      const alvo = "vitima@example.com";
      const primeiro = await criarJogador();
      const contaDoPrimeiro = await criarConta(primeiro, { contactEmail: alvo });
      const grupoA = await criarGrupo("Grupo A");
      await criarConviteDeGrupo(grupoA, primeiro, {
        emailEnviadoHaMinutos: 5,
        emailEnviadoPara: alvo,
      });

      // O primeiro desvia o próprio contato: a linha carimbada não aponta mais
      // para a caixa que recebeu, se a janela reler a conta.
      await db
        .update(users)
        .set({ contactEmail: "outro@example.com" })
        .where(eq(users.id, contaDoPrimeiro.id));

      const segundo = await criarJogador();
      await criarConta(segundo, { contactEmail: alvo });
      const grupoB = await criarGrupo("Grupo B");
      const convite = await criarConviteDeGrupo(grupoB, segundo);
      const fetchMock = stubResend();

      const resultado = await reenviarAvisoDeGrupo(grupoB, convite.id);

      expect(resultado).toEqual({ ok: false, motivo: "envio-recente" });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    // O envio de verdade é quem alimenta o freio acima — se ele não gravar o
    // endereço, a proteção nasce morta na próxima janela.
    it("o envio grava para onde o aviso saiu", async () => {
      const groupId = await criarGrupo();
      const jogador = await criarJogador();
      await criarConta(jogador, { contactEmail: "so-contato@example.com" });
      const convite = await criarConviteDeGrupo(groupId, jogador);
      stubResend();

      await reenviarAvisoDeGrupo(groupId, convite.id);

      const [depois] = await db
        .select()
        .from(groupInvitations)
        .where(eq(groupInvitations.id, convite.id));
      expect(depois.emailSentTo).toBe("so-contato@example.com");
    });

    it("passada a janela, o outro grupo volta a poder avisar", async () => {
      const convidado = await criarConvidado();
      const grupoA = await criarGrupo("Grupo A");
      await criarConviteDeGrupo(grupoA, convidado, { emailEnviadoHaMinutos: 11 });
      const grupoB = await criarGrupo("Grupo B");
      const convite = await criarConviteDeGrupo(grupoB, convidado);
      const fetchMock = stubResend();

      const resultado = await reenviarAvisoDeGrupo(grupoB, convite.id);

      expect(resultado).toEqual({ ok: true });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    // O outro fluxo conta igual: o convite de plataforma sai para o endereço da
    // conta, que é o mesmo endereço para onde o aviso de grupo iria.
    it("convite de plataforma recente para a mesma caixa bloqueia o aviso", async () => {
      const convidado = await criarConvidado();
      await criarConvite(convidado, { email: EMAIL, emailEnviadoHaMinutos: 5 });
      const groupId = await criarGrupo();
      const convite = await criarConviteDeGrupo(groupId, convidado);
      const fetchMock = stubResend();

      const resultado = await reenviarAvisoDeGrupo(groupId, convite.id);

      expect(resultado).toEqual({ ok: false, motivo: "envio-recente" });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("tetos", () => {
    // O teto é por quem dispara e NÃO por grupo — é justamente o contorno de
    // criar grupo atrás de grupo que ele fecha. Por isso o volume mora em outro
    // grupo: com ele no mesmo grupo, um filtro por groupId na consulta passaria
    // no teste e mataria a proteção em produção.
    it("40 avisos do mesmo convidante nas 24h barram, mesmo vindos de outro grupo", async () => {
      const grupoDoVolume = await criarGrupo("Grupo do Volume");
      const convidante = await criarJogador();
      const alvoDoVolume = await criarJogador();
      await criarVolumeDeAvisosDeGrupo(grupoDoVolume, alvoDoVolume, 40, {
        convidadoPor: convidante,
      });
      const groupId = await criarGrupo();
      const convidado = await criarConvidado();
      const convite = await criarConviteDeGrupo(groupId, convidado, { convidadoPor: convidante });
      const fetchMock = stubResend();

      const resultado = await reenviarAvisoDeGrupo(groupId, convite.id);

      expect(resultado).toEqual({ ok: false, motivo: "limite-do-convidante" });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("com 39 avisos o convidante ainda envia", async () => {
      const grupoDoVolume = await criarGrupo("Grupo do Volume");
      const convidante = await criarJogador();
      const alvoDoVolume = await criarJogador();
      await criarVolumeDeAvisosDeGrupo(grupoDoVolume, alvoDoVolume, 39, {
        convidadoPor: convidante,
      });
      const groupId = await criarGrupo();
      const convidado = await criarConvidado();
      const convite = await criarConviteDeGrupo(groupId, convidado, { convidadoPor: convidante });
      const fetchMock = stubResend();

      const resultado = await reenviarAvisoDeGrupo(groupId, convite.id);

      expect(resultado).toEqual({ ok: true });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("o teto diário combinado também barra o aviso de grupo", async () => {
      const volume = await criarJogador();
      await criarVolumeDeConvites(volume, 90, { enviadoHaUmaHora: true });
      const groupId = await criarGrupo();
      const convidado = await criarConvidado();
      const convite = await criarConviteDeGrupo(groupId, convidado);
      const fetchMock = stubResend();

      const resultado = await reenviarAvisoDeGrupo(groupId, convite.id);

      expect(resultado).toEqual({ ok: false, motivo: "limite" });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("resposta do transporte", () => {
    it("429 de cota devolve limite e email_sent_at continua nulo", async () => {
      const groupId = await criarGrupo();
      const convidado = await criarConvidado();
      const convite = await criarConviteDeGrupo(groupId, convidado);
      const fetchMock = stubResend({ status: 429, corpo: { name: "daily_quota_exceeded" } });

      const resultado = await reenviarAvisoDeGrupo(groupId, convite.id);

      expect(resultado).toEqual({ ok: false, motivo: "limite" });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const depois = await lerConviteDeGrupo(convite.id);
      expect(depois.emailSentAt).toBeNull();
    });
  });
});
