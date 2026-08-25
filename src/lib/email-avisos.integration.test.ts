// O despacho de e-mail dos avisos da caixa de entrada contra o banco de
// verdade: quem recebe, quem é descartado, e o carimbo que impede o segundo
// envio.
//
// A maioria dos casos chama `despacharEmailsDeAvisos()` direto, e não a action
// que gera o aviso: o que está sob teste é o despachante — a allowlist, o
// destino, o opt-out e o at-most-once. Os dois casos ponta a ponta no fim
// cobrem o caminho de verdade, da action ao Resend.

import { eq, isNull, sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { notifications, users, type NotificationType, type Player } from "@/db/schema";
import { despacharEmailsDeAvisos } from "@/lib/email-avisos";
import { notificar } from "@/lib/notifications";
import { criarJogador, criarJogadorComConta } from "@/test/fixtures";
import { payloadDoEnvio, stubResend } from "@/test/resend-fake";

afterEach(() => {
  vi.unstubAllEnvs();
});

/**
 * Contas de fixture nascem sem endereço nenhum, e `emailDeDestino()` é
 * `coalesce(users.email, users.contact_email)` — sem isto todo teste daqui
 * passaria verde sem mandar nada.
 */
async function darEmail(jogador: Player, endereco?: string): Promise<string> {
  const email = endereco ?? `jogador${jogador.id}@example.com`;
  await db.update(users).set({ email }).where(eq(users.playerId, jogador.id));
  return email;
}

/** Um jogador com conta e endereço — o caso comum destes testes. */
async function comEmail(): Promise<{ jogador: Player; email: string }> {
  const { jogador } = await criarJogadorComConta();
  return { jogador, email: await darEmail(jogador) };
}

async function avisar(
  playerId: number,
  type: NotificationType,
  extra: { title?: string; body?: string; href?: string } = {},
): Promise<void> {
  await notificar(db, [
    {
      playerId,
      type,
      title: extra.title ?? "Te chamaram para um fut",
      body: extra.body ?? "Ana chamou você para o fut de 24/08.",
      href: extra.href ?? "/fut/1",
      dedupeKey: `teste:${type}:${playerId}:${Math.random()}`,
    },
  ]);
}

/** Quantos avisos deste jogador ainda estão pendentes de e-mail. */
async function pendentes(playerId: number): Promise<number> {
  const [linha] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(notifications)
    .where(sql`${notifications.playerId} = ${playerId} and ${notifications.emailDispatchedAt} is null`);
  return linha?.total ?? 0;
}

describe("despacharEmailsDeAvisos", () => {
  it("manda o aviso de tipo da allowlist para quem tem endereço", async () => {
    const { jogador, email } = await comEmail();
    await avisar(jogador.id, "fut_convite");

    const fetchMock = stubResend();
    const resultado = await despacharEmailsDeAvisos();

    expect(resultado.enviados).toBe(1);
    const payload = payloadDoEnvio(fetchMock);
    expect(payload.to).toEqual([email]);
    expect(payload.subject).toBe("Te chamaram para um fut");
    // O corpo do e-mail sai do `body` da notificação — é o que dispensa um
    // template por tipo.
    expect(payload.html).toContain("Ana chamou você para o fut de 24/08.");
    expect(payload.text).toContain("Ana chamou você para o fut de 24/08.");
    expect(payload.html).toContain("/fut/1");
  });

  // O carimbo é o que torna o despacho at-most-once.
  it("segunda passada não reenvia", async () => {
    const { jogador } = await comEmail();
    await avisar(jogador.id, "fut_convite");

    const fetchMock = stubResend();
    await despacharEmailsDeAvisos();
    const segunda = await despacharEmailsDeAvisos();

    expect(segunda.enviados).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await pendentes(jogador.id)).toBe(0);
  });

  // A regra que impede o candidato eterno: o que não vira e-mail sai da fila
  // do mesmo jeito. Ver reivindicarPendentesDeEmail.
  it("tipo fora da allowlist é marcado sem envio", async () => {
    const { jogador } = await comEmail();
    await avisar(jogador.id, "fut_encerrado");

    const fetchMock = stubResend();
    const resultado = await despacharEmailsDeAvisos();

    expect(resultado.enviados).toBe(0);
    expect(resultado.ignorados).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await pendentes(jogador.id)).toBe(0);
  });

  it("quem não tem endereço é marcado sem envio", async () => {
    const { jogador } = await criarJogadorComConta();
    await avisar(jogador.id, "fut_convite");

    const fetchMock = stubResend();
    const resultado = await despacharEmailsDeAvisos();

    expect(resultado.enviados).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await pendentes(jogador.id)).toBe(0);
  });

  // Jogador sem conta nenhuma (o convidado que ainda não resgatou o convite).
  // O `left join` do claim existe para ele: um inner o deixaria pendente para
  // sempre.
  it("jogador sem conta é marcado sem envio", async () => {
    const jogador = await criarJogador();
    await avisar(jogador.id, "fut_convite");

    const fetchMock = stubResend();
    await despacharEmailsDeAvisos();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(await pendentes(jogador.id)).toBe(0);
  });

  it("conta desativada não recebe", async () => {
    const { jogador } = await comEmail();
    await db.update(users).set({ active: false }).where(eq(users.playerId, jogador.id));
    await avisar(jogador.id, "fut_convite");

    const fetchMock = stubResend();
    await despacharEmailsDeAvisos();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(await pendentes(jogador.id)).toBe(0);
  });

  // Rede de segurança do backfill da migration 0037.
  it("aviso velho é marcado sem envio", async () => {
    const { jogador } = await comEmail();
    await avisar(jogador.id, "fut_convite");
    // Retroativo pelo Postgres, nunca com `new Date()` em SQL cru.
    await db
      .update(notifications)
      .set({ createdAt: sql`now() - interval '25 hours'` })
      .where(eq(notifications.playerId, jogador.id));

    const fetchMock = stubResend();
    const resultado = await despacharEmailsDeAvisos();

    expect(resultado.enviados).toBe(0);
    expect(resultado.ignorados).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await pendentes(jogador.id)).toBe(0);
  });

  it("o e-mail que falha não volta para a fila", async () => {
    const { jogador } = await comEmail();
    await avisar(jogador.id, "fut_convite");

    const fetchMock = stubResend(500);
    const resultado = await despacharEmailsDeAvisos();

    expect(resultado.falhas).toBe(1);
    expect(resultado.enviados).toBe(0);
    // At-most-once: o claim já marcou, e o aviso continua na caixa de entrada.
    expect(await pendentes(jogador.id)).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // O kill switch da casa: sem key, nem toca o banco.
  it("sem RESEND_API_KEY nada sai e nada é marcado", async () => {
    const { jogador } = await comEmail();
    await avisar(jogador.id, "fut_convite");

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const resultado = await despacharEmailsDeAvisos();

    expect(resultado.enviados).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    // Continua pendente: quando a key voltar, o aviso ainda sai.
    expect(await pendentes(jogador.id)).toBe(1);
  });

  describe("o toggle de /perfil", () => {
    it("quem desligou não recebe os avisáveis", async () => {
      const { jogador } = await comEmail();
      await db
        .update(users)
        .set({ avisosPorEmail: false })
        .where(eq(users.playerId, jogador.id));
      await avisar(jogador.id, "fut_convite");

      const fetchMock = stubResend();
      const resultado = await despacharEmailsDeAvisos();

      expect(resultado.enviados).toBe(0);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(await pendentes(jogador.id)).toBe(0);
    });

    it("mas continua recebendo os transacionais", async () => {
      const { jogador } = await comEmail();
      await db
        .update(users)
        .set({ avisosPorEmail: false })
        .where(eq(users.playerId, jogador.id));
      await avisar(jogador.id, "recarga_confirmada", {
        title: "Suas 100 zenhas chegaram",
        href: "/zenhas",
      });

      const fetchMock = stubResend();
      const resultado = await despacharEmailsDeAvisos();

      expect(resultado.enviados).toBe(1);
      expect(payloadDoEnvio(fetchMock).subject).toBe("Suas 100 zenhas chegaram");
    });
  });

  describe("List-Unsubscribe", () => {
    it("acompanha o avisável, que é o que o toggle desliga", async () => {
      const { jogador } = await comEmail();
      await avisar(jogador.id, "fut_convite");

      const fetchMock = stubResend();
      await despacharEmailsDeAvisos();

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const payload = JSON.parse(init.body as string);
      expect(payload.headers["List-Unsubscribe"]).toContain("/perfil");
      // Os sinais do RFC 2369 — sem eles o header é ignorado em silêncio.
      expect(payload.headers["List-Unsubscribe"]).toMatch(/^<https?:\/\/.+\/perfil>$/);
    });

    // Anunciar um descadastro que não vale para aquele e-mail é pior que não
    // anunciar nenhum.
    it("não acompanha o transacional, que continua saindo", async () => {
      const { jogador } = await comEmail();
      await avisar(jogador.id, "recarga_confirmada");

      const fetchMock = stubResend();
      await despacharEmailsDeAvisos();

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(JSON.parse(init.body as string).headers).toBeUndefined();
    });
  });

  it("despacha um lote com vários destinatários", async () => {
    const a = await comEmail();
    const b = await comEmail();
    await avisar(a.jogador.id, "deletion_vote_open", { title: "Votação: excluir um fut" });
    await avisar(b.jogador.id, "deletion_vote_open", { title: "Votação: excluir um fut" });

    const fetchMock = stubResend();
    const resultado = await despacharEmailsDeAvisos();

    expect(resultado.enviados).toBe(2);
    const destinos = [payloadDoEnvio(fetchMock, 0).to[0], payloadDoEnvio(fetchMock, 1).to[0]];
    expect(destinos.sort()).toEqual([a.email, b.email].sort());
  });

  it("o e-mail vai para o contact_email quando não há e-mail de credencial", async () => {
    const { jogador } = await criarJogadorComConta();
    await db
      .update(users)
      .set({ contactEmail: "contato@example.com" })
      .where(eq(users.playerId, jogador.id));
    await avisar(jogador.id, "fut_convite");

    const fetchMock = stubResend();
    await despacharEmailsDeAvisos();

    expect(payloadDoEnvio(fetchMock).to).toEqual(["contato@example.com"]);
  });

  // A precedência de emailDeDestino: o verificado na frente do auto-declarado.
  it("o e-mail verificado tem precedência sobre o de contato", async () => {
    const { jogador } = await criarJogadorComConta();
    await db
      .update(users)
      .set({ email: "verificado@example.com", contactEmail: "contato@example.com" })
      .where(eq(users.playerId, jogador.id));
    await avisar(jogador.id, "fut_convite");

    const fetchMock = stubResend();
    await despacharEmailsDeAvisos();

    expect(payloadDoEnvio(fetchMock).to).toEqual(["verificado@example.com"]);
  });

  it("sem avisos pendentes não fala com o Resend", async () => {
    const fetchMock = stubResend();
    const resultado = await despacharEmailsDeAvisos();

    expect(resultado.enviados).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  /**
   * A ordem do claim, e o que ela conserta.
   *
   * O lote tem teto por varredura e a fila mistura os 26 tipos, dos quais 19
   * nunca viram e-mail. Com `asc(id)` puro, o convite gravado logo depois de um
   * fut encerrar (~50 linhas mudas de uma vez) ficava atrás delas: a passada que
   * `convidarParaOFut` força justamente para o convite sair AGORA drenava o
   * atraso e não alcançava o convite. Ver reivindicarPendentesDeEmail.
   *
   * Vinte e cinco linhas mudas passam do teto por varredura de propósito — com
   * menos, o convite caberia no lote por sorte e o teste passaria sem a correção.
   */
  it("o avisável fura a fila dos tipos que nunca viram e-mail", async () => {
    const { jogador, email } = await comEmail();
    for (let i = 0; i < 25; i += 1) await avisar(jogador.id, "fut_encerrado");
    await avisar(jogador.id, "fut_convite", { title: "Te chamaram para um fut" });

    const fetchMock = stubResend();
    const resultado = await despacharEmailsDeAvisos();

    expect(resultado.enviados).toBe(1);
    const payload = payloadDoEnvio(fetchMock);
    expect(payload.to).toEqual([email]);
    expect(payload.subject).toBe("Te chamaram para um fut");
  });
});

describe("a fila não guarda pendente que nunca sairia", () => {
  // O invariante que fecha o buraco do candidato eterno, num teste só: depois de
  // uma passada, NADA fica pendente — nem o tipo de fora, nem o sem endereço,
  // nem o velho, nem o do opt-out.
  it("uma passada esvazia a fila, envie ou não envie", async () => {
    const semConta = await criarJogador();
    const { jogador: semEmail } = await criarJogadorComConta();
    const { jogador: desligado } = await comEmail();
    await db
      .update(users)
      .set({ avisosPorEmail: false })
      .where(eq(users.playerId, desligado.id));
    const { jogador: recebe } = await comEmail();

    await avisar(semConta.id, "fut_convite");
    await avisar(semEmail.id, "fut_convite");
    await avisar(desligado.id, "fut_convite");
    await avisar(recebe.id, "fut_encerrado");
    await avisar(recebe.id, "fut_convite");

    stubResend();
    const resultado = await despacharEmailsDeAvisos();

    expect(resultado.enviados).toBe(1);
    expect(resultado.ignorados).toBe(4);

    const [linha] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(notifications)
      .where(isNull(notifications.emailDispatchedAt));
    expect(linha.total).toBe(0);
  });
});
