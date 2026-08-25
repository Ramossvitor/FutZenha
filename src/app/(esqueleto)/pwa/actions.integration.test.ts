// As actions de PWA contra o banco de verdade: o upsert da assinatura pelo
// endpoint, o cancelamento que só apaga o que é do dono, e as marcas de
// instalação. Todas são fire-and-forget de useEffect/clique — sem sessão, a
// regra é no-op, nunca redirect.

import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { pushSubscriptions, users } from "@/db/schema";
import {
  assinarPush,
  cancelarPush,
  marcarCtaPwaClicado,
  marcarPwaInstalado,
} from "@/app/(esqueleto)/pwa/actions";
import { criarJogadorComConta, deslogar, logarComo } from "@/test/fixtures";

function subscription(endpoint: string, chaves: { p256dh?: string; auth?: string } = {}) {
  return {
    endpoint,
    keys: {
      p256dh: chaves.p256dh ?? "chave-p256dh-de-teste",
      auth: chaves.auth ?? "chave-auth-de-teste",
    },
  };
}

// Host real de push service: a action só aceita os conhecidos — ver
// HOSTS_DE_PUSH em actions.ts para o porquê (SSRF).
const ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc123";
const OUTRO_ENDPOINT = "https://web.push.apple.com/envio/xyz789";

describe("assinarPush", () => {
  it("grava a assinatura do device para o jogador da sessão", async () => {
    const { jogador, conta } = await criarJogadorComConta();
    await logarComo(conta);

    expect(await assinarPush(subscription(ENDPOINT))).toEqual({ ok: true });

    const linhas = await db.select().from(pushSubscriptions);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({ playerId: jogador.id, endpoint: ENDPOINT });
  });

  it("re-assinar o mesmo endpoint troca o dono E as chaves, em vez de duplicar", async () => {
    const { conta: contaA } = await criarJogadorComConta();
    const { jogador: jogadorB, conta: contaB } = await criarJogadorComConta();
    await logarComo(contaA);
    await assinarPush(subscription(ENDPOINT));

    // O mesmo aparelho, agora logado com outra conta: um device entrega para
    // um jogador por vez.
    await logarComo(contaB);
    await assinarPush(subscription(ENDPOINT, { p256dh: "p256dh-do-b", auth: "auth-do-b" }));

    const linhas = await db.select().from(pushSubscriptions);
    expect(linhas).toHaveLength(1);
    // As chaves têm que acompanhar o dono: guardar as antigas apontando para o
    // jogador novo faria todo push falhar na descriptografia do push service —
    // e isso conta como "falha genérica" no despacho, sem erro visível a
    // ninguém.
    expect(linhas[0]).toMatchObject({
      playerId: jogadorB.id,
      p256dh: "p256dh-do-b",
      auth: "auth-do-b",
    });
  });

  it("payload fora do contrato e sessão ausente voltam ok:false sem gravar", async () => {
    const { conta } = await criarJogadorComConta();
    await logarComo(conta);
    expect(await assinarPush({ endpoint: "http://sem-tls.example.com" })).toEqual({ ok: false });
    expect(await assinarPush("lixo")).toEqual({ ok: false });

    deslogar();
    expect(await assinarPush(subscription(ENDPOINT))).toEqual({ ok: false });

    expect(await db.select().from(pushSubscriptions)).toHaveLength(0);
  });

  // A action é endpoint HTTP público: sem a lista de hosts, um jogador logado
  // gravava um endpoint qualquer e o despacho fazia o SERVIDOR abrir um POST
  // https para lá, com o JWT VAPID junto. SSRF de graça.
  it("recusa endpoint que não seja de um push service conhecido", async () => {
    const { conta } = await criarJogadorComConta();
    await logarComo(conta);

    for (const endpoint of [
      "https://interno.rede.local/admin",
      "https://169.254.169.254/latest/meta-data/",
      "https://evil.com/coleta",
      // Sufixo tem que casar no ponto: um domínio que só TERMINA com o nome não
      // vale.
      "https://naoehfcm.googleapis.com.evil.com/x",
    ]) {
      expect(await assinarPush(subscription(endpoint))).toEqual({ ok: false });
    }
    expect(await db.select().from(pushSubscriptions)).toHaveLength(0);

    // Os de verdade continuam passando.
    for (const endpoint of [
      ENDPOINT,
      OUTRO_ENDPOINT,
      "https://updates.push.services.mozilla.com/wpush/v2/abc",
    ]) {
      expect(await assinarPush(subscription(endpoint))).toEqual({ ok: true });
    }
    expect(await db.select().from(pushSubscriptions)).toHaveLength(3);
  });

  // Cada assinatura multiplica o fan-out do despacho (uma requisição por aviso
  // × assinatura), e o claim marca o lote ANTES de enviar: uma conta com
  // endpoints em massa derrubava a varredura e suprimia o push de todo mundo
  // naquele lote.
  it("mantém no máximo 20 assinaturas por jogador, descartando as mais velhas", async () => {
    const { jogador, conta } = await criarJogadorComConta();
    await logarComo(conta);

    for (let i = 0; i < 25; i++) {
      await assinarPush(subscription(`https://fcm.googleapis.com/fcm/send/device-${i}`));
    }

    const linhas = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.playerId, jogador.id));
    expect(linhas).toHaveLength(20);
    // A mais nova sobrevive; a primeira, não.
    const endpoints = linhas.map((l) => l.endpoint);
    expect(endpoints).toContain("https://fcm.googleapis.com/fcm/send/device-24");
    expect(endpoints).not.toContain("https://fcm.googleapis.com/fcm/send/device-0");
  });
});

describe("cancelarPush", () => {
  it("apaga só a assinatura do próprio jogador — endpoint alheio fica", async () => {
    const { conta: contaA } = await criarJogadorComConta();
    const { conta: contaB } = await criarJogadorComConta();
    await logarComo(contaA);
    await assinarPush(subscription(ENDPOINT));
    await logarComo(contaB);
    await assinarPush(subscription(OUTRO_ENDPOINT));

    // B tenta cancelar o endpoint de A: nada acontece.
    await cancelarPush(ENDPOINT);
    expect(await db.select().from(pushSubscriptions)).toHaveLength(2);

    // B cancela o próprio: some só o dele.
    await cancelarPush(OUTRO_ENDPOINT);
    const restantes = await db.select().from(pushSubscriptions);
    expect(restantes).toHaveLength(1);
    expect(restantes[0].endpoint).toBe(ENDPOINT);
  });
});

describe("marcas de PWA", () => {
  it("marcarPwaInstalado grava uma vez e preserva a primeira data", async () => {
    const { conta } = await criarJogadorComConta();
    await logarComo(conta);

    await marcarPwaInstalado();
    const [antes] = await db.select().from(users).where(eq(users.id, conta.id));
    expect(antes.pwaInstaladoEm).not.toBeNull();

    // Abrir o app de novo não é reinstalar — a data não anda.
    await marcarPwaInstalado();
    const [depois] = await db.select().from(users).where(eq(users.id, conta.id));
    expect(depois.pwaInstaladoEm).toEqual(antes.pwaInstaladoEm);
  });

  it("marcarCtaPwaClicado registra o clique; sem sessão, nada acontece", async () => {
    const { conta } = await criarJogadorComConta();
    await logarComo(conta);
    await marcarCtaPwaClicado();
    const [linha] = await db.select().from(users).where(eq(users.id, conta.id));
    expect(linha.pwaCtaClicadoEm).not.toBeNull();
    expect(linha.pwaInstaladoEm).toBeNull();

    deslogar();
    await marcarPwaInstalado();
    const [aindaSem] = await db.select().from(users).where(eq(users.id, conta.id));
    expect(aindaSem.pwaInstaladoEm).toBeNull();
  });
});
