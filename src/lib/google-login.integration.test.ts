import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { users } from "@/db/schema";
import { criarJogadorComConta } from "@/test/fixtures";
import { resolverLoginGoogle } from "./google-login";

const IDENTIDADE = {
  sub: "sub-de-quem-chegou",
  email: "alvo@example.com",
  emailVerified: true,
  name: "Quem Chegou",
};

describe("resolverLoginGoogle e o e-mail de contato", () => {
  /**
   * O teste que justifica a coluna separada.
   *
   * Uma conta cujo ÚNICO endereço é o de contato — digitado por ela mesma ou
   * pelo admin, sem ninguém verificar — não pode ser encontrada pelo login. Se
   * fosse, bastaria informar o e-mail de outra pessoa no perfil para que o
   * Google dela caísse nesta conta: o endereço vira credencial sem que ninguém
   * tenha provado possuí-lo.
   *
   * Sem convite, a resposta certa é "sem-convite": o login não conhece ninguém.
   */
  it("não encontra conta pelo e-mail de contato", async () => {
    const { conta } = await criarJogadorComConta(
      {},
      { username: "dono", contactEmail: IDENTIDADE.email },
    );

    const resultado = await resolverLoginGoogle(IDENTIDADE, {});

    expect(resultado).toEqual({ ok: false, erro: "sem-convite" });
    const [depois] = await db.select().from(users).where(eq(users.id, conta.id));
    expect(depois.googleSub).toBeNull();
    expect(depois.email).toBeNull();
    expect(depois.contactEmail).toBe(IDENTIDADE.email);
  });

  // O contraste que dá sentido ao teste acima: pelo endereço VERIFICADO o
  // vínculo acontece, e é esse caminho que o de contato não pode imitar.
  it("encontra e vincula pela coluna de e-mail verificado", async () => {
    const { conta } = await criarJogadorComConta(
      {},
      { username: "veterano", email: IDENTIDADE.email },
    );

    const resultado = await resolverLoginGoogle(IDENTIDADE, {});

    expect(resultado.ok).toBe(true);
    const [depois] = await db.select().from(users).where(eq(users.id, conta.id));
    expect(depois.googleSub).toBe(IDENTIDADE.sub);
    expect(depois.tokenVersion).toBe(conta.tokenVersion + 1);
  });
});
