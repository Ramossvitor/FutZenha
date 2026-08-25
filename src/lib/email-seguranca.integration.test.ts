// Os avisos de credencial trocada, do call site ao Resend.
//
// Tudo passa pela action de verdade + `flushAfter()`, e não pela função interna:
// o envio mora num `after()`, e testar o orquestrador direto pularia justamente
// o agendamento — que é onde o kill switch e o `try/catch` estão.

import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { changePassword } from "@/app/(esqueleto)/perfil/actions";
import { db } from "@/db";
import { users } from "@/db/schema";
import { resolverLoginGoogle } from "@/lib/google-login";
import { flushAfter } from "@/test/after-flush";
import { criarJogadorComConta, logarComo, SENHA_DE_TESTE } from "@/test/fixtures";
import { payloadDoEnvio, stubResend } from "@/test/resend-fake";

afterEach(() => {
  vi.unstubAllEnvs();
});

function formDeTroca(nova: string): FormData {
  const form = new FormData();
  form.set("currentPassword", SENHA_DE_TESTE);
  form.set("newPassword", nova);
  form.set("confirm", nova);
  return form;
}

const SENHA_NOVA = "outra-senha-de-teste-456";

describe("aviso de senha alterada", () => {
  it("sai para o e-mail da conta depois da troca", async () => {
    const { jogador, conta } = await criarJogadorComConta({ nickname: "Zé" });
    await db
      .update(users)
      .set({ email: "ze@example.com" })
      .where(eq(users.id, conta.id));
    await logarComo(conta);

    const fetchMock = stubResend();
    const estado = await changePassword({}, formDeTroca(SENHA_NOVA));
    await flushAfter();

    expect(estado.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const payload = payloadDoEnvio(fetchMock);
    expect(payload.to).toEqual(["ze@example.com"]);
    expect(payload.subject).toContain("senha");
    // O apelido na frente do nome, como em todo tratamento do projeto.
    expect(payload.html).toContain("Zé");
    expect(payload.text).toContain("encerradas");
    expect(jogador.id).toBeGreaterThan(0);
  });

  // Ver o bloco de segurança em email-modelos.ts: e-mail que avisa de credencial
  // trocada e pede clique ensina o reflexo que o phishing explora.
  it("não leva link nenhum", async () => {
    const { conta } = await criarJogadorComConta();
    await db.update(users).set({ email: "ze@example.com" }).where(eq(users.id, conta.id));
    await logarComo(conta);

    const fetchMock = stubResend();
    await changePassword({}, formDeTroca(SENHA_NOVA));
    await flushAfter();

    const payload = payloadDoEnvio(fetchMock);
    expect(payload.html).not.toContain("<a href=");
    expect(payload.text).not.toContain("http");
  });

  it("conta sem endereço nenhum não recebe — e a troca acontece do mesmo jeito", async () => {
    const { conta } = await criarJogadorComConta();
    await logarComo(conta);

    const fetchMock = stubResend();
    const estado = await changePassword({}, formDeTroca(SENHA_NOVA));
    await flushAfter();

    expect(estado.success).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("vai para o contact_email quando não há e-mail de credencial", async () => {
    const { conta } = await criarJogadorComConta();
    await db
      .update(users)
      .set({ contactEmail: "contato@example.com" })
      .where(eq(users.id, conta.id));
    await logarComo(conta);

    const fetchMock = stubResend();
    await changePassword({}, formDeTroca(SENHA_NOVA));
    await flushAfter();

    expect(payloadDoEnvio(fetchMock).to).toEqual(["contato@example.com"]);
  });

  // A troca não pode depender do e-mail: `enviarEmail` nunca lança, e o `after`
  // tem `try/catch` próprio.
  it("Resend fora do ar não derruba a troca de senha", async () => {
    const { conta } = await criarJogadorComConta();
    await db.update(users).set({ email: "ze@example.com" }).where(eq(users.id, conta.id));
    await logarComo(conta);

    stubResend(500);
    const estado = await changePassword({}, formDeTroca(SENHA_NOVA));
    await flushAfter();

    expect(estado.success).toBe(true);
    // A senha nova vale mesmo assim.
    const [depois] = await db.select().from(users).where(eq(users.id, conta.id));
    expect(depois.tokenVersion).toBe(conta.tokenVersion + 1);
  });

  it("senha atual errada não manda e-mail nenhum", async () => {
    const { conta } = await criarJogadorComConta();
    await db.update(users).set({ email: "ze@example.com" }).where(eq(users.id, conta.id));
    await logarComo(conta);

    const fetchMock = stubResend();
    const form = new FormData();
    form.set("currentPassword", "essa-nao-e-a-senha");
    form.set("newPassword", SENHA_NOVA);
    form.set("confirm", SENHA_NOVA);
    const estado = await changePassword({}, form);
    await flushAfter();

    expect(estado.error).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sem RESEND_API_KEY a troca segue e nada vai à rede", async () => {
    const { conta } = await criarJogadorComConta();
    await db.update(users).set({ email: "ze@example.com" }).where(eq(users.id, conta.id));
    await logarComo(conta);

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const estado = await changePassword({}, formDeTroca(SENHA_NOVA));
    await flushAfter();

    expect(estado.success).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// O outro lado do módulo. Passa por `resolverLoginGoogle` com `link`, que é o
// vínculo pedido de dentro do /perfil — o mesmo caminho da rota de callback,
// onde `pendente.link = session.userId`.
describe("aviso de conta Google vinculada", () => {
  const IDENTIDADE = {
    sub: "sub-do-google",
    email: "vinculado@example.com",
    emailVerified: true,
    name: "Quem Vinculou",
  };

  it("sai quando o vínculo grava, e diz qual endereço passou a entrar", async () => {
    const { conta } = await criarJogadorComConta({ nickname: "Zé" });

    const fetchMock = stubResend();
    const resultado = await resolverLoginGoogle(IDENTIDADE, { link: conta.id });
    await flushAfter();

    expect(resultado.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const payload = payloadDoEnvio(fetchMock);
    // Depois do vínculo o destino da conta É o endereço novo.
    expect(payload.to).toEqual([IDENTIDADE.email]);
    expect(payload.subject).toContain("Google");
    expect(payload.html).toContain(IDENTIDADE.email);
    expect(payload.html).toContain("Zé");
  });

  /**
   * O caso que o aviso existe para cobrir, e o motivo de `paraTambem`.
   *
   * O vínculo grava `users.email`, e `emailDeDestino` é um coalesce: sem levar o
   * destino anterior, o aviso de que a credencial mudou sairia SÓ para o
   * endereço recém-vinculado — quem tomou a sessão avisa a si mesmo, e o dono,
   * que até um instante atrás era o destino da conta, não fica sabendo.
   */
  it("também alcança o destino anterior da conta", async () => {
    const { conta } = await criarJogadorComConta();
    await db
      .update(users)
      .set({ contactEmail: "dono@example.com" })
      .where(eq(users.id, conta.id));

    const fetchMock = stubResend();
    await resolverLoginGoogle(IDENTIDADE, { link: conta.id });
    await flushAfter();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Dois envios separados, e não um `to` com os dois: um deles pode ser de
    // quem tomou a conta, e não se entrega o endereço do dono a essa pessoa.
    const destinos = [payloadDoEnvio(fetchMock, 0).to, payloadDoEnvio(fetchMock, 1).to];
    expect(destinos).toContainEqual([IDENTIDADE.email]);
    expect(destinos).toContainEqual(["dono@example.com"]);
  });

  it("destino que não mudou não recebe duas vezes", async () => {
    const { conta } = await criarJogadorComConta();
    await db.update(users).set({ contactEmail: IDENTIDADE.email }).where(eq(users.id, conta.id));

    const fetchMock = stubResend();
    await resolverLoginGoogle(IDENTIDADE, { link: conta.id });
    await flushAfter();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // Ver o bloco de segurança em email-modelos.ts.
  it("não leva link nenhum", async () => {
    const { conta } = await criarJogadorComConta();

    const fetchMock = stubResend();
    await resolverLoginGoogle(IDENTIDADE, { link: conta.id });
    await flushAfter();

    const payload = payloadDoEnvio(fetchMock);
    expect(payload.html).not.toContain("<a href=");
    expect(payload.text).not.toContain("http");
  });

  // O vínculo é o fato; o e-mail é aceleração dele, como em toda esta família.
  it("Resend fora do ar não derruba o vínculo", async () => {
    const { conta } = await criarJogadorComConta();

    stubResend(500);
    const resultado = await resolverLoginGoogle(IDENTIDADE, { link: conta.id });
    await flushAfter();

    expect(resultado.ok).toBe(true);
    const [depois] = await db.select().from(users).where(eq(users.id, conta.id));
    expect(depois.googleSub).toBe(IDENTIDADE.sub);
  });

  it("vínculo recusado não manda e-mail nenhum", async () => {
    const { conta: dona } = await criarJogadorComConta();
    await db.update(users).set({ googleSub: "sub-de-outra" }).where(eq(users.id, dona.id));

    const fetchMock = stubResend();
    const resultado = await resolverLoginGoogle(IDENTIDADE, { link: dona.id });
    await flushAfter();

    expect(resultado).toEqual({ ok: false, erro: "google-ja-vinculado" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
