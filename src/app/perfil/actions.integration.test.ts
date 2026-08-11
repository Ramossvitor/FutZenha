import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { users } from "@/db/schema";
import { salvarEmailDeContato } from "@/app/perfil/actions";
import { criarJogadorComConta, deslogar, logarComo } from "@/test/fixtures";
import { esperaRedirect } from "@/test/navigation-fake";

function formulario(email: string | null): FormData {
  const fd = new FormData();
  if (email !== null) fd.set("contactEmail", email);
  return fd;
}

describe("salvarEmailDeContato", () => {
  it("grava o endereço normalizado na própria conta", async () => {
    const { conta } = await criarJogadorComConta();
    await logarComo(conta);

    const resultado = await salvarEmailDeContato({}, formulario("  Eu@Example.COM "));

    expect(resultado).toEqual({ success: true });
    const [depois] = await db.select().from(users).where(eq(users.id, conta.id));
    expect(depois.contactEmail).toBe("eu@example.com");
  });

  // Contato não é credencial: mudar o endereço não derruba as sessões abertas
  // — e, principalmente, não escreve na coluna que o login pelo Google lê.
  it("não toca em users.email nem em token_version", async () => {
    const { conta } = await criarJogadorComConta();
    await logarComo(conta);

    await salvarEmailDeContato({}, formulario("eu@example.com"));

    const [depois] = await db.select().from(users).where(eq(users.id, conta.id));
    expect(depois.email).toBeNull();
    expect(depois.tokenVersion).toBe(conta.tokenVersion);
  });

  it("recusa endereço inválido e vazio sem gravar", async () => {
    const { conta } = await criarJogadorComConta();
    await logarComo(conta);

    expect(await salvarEmailDeContato({}, formulario("sem-arroba"))).toEqual({
      error: "E-mail inválido — confira o endereço.",
    });
    expect(await salvarEmailDeContato({}, formulario(null))).toEqual({
      error: "Informe seu e-mail.",
    });

    const [depois] = await db.select().from(users).where(eq(users.id, conta.id));
    expect(depois.contactEmail).toBeNull();
  });

  it("sem sessão manda para o login sem gravar nada", async () => {
    const { conta } = await criarJogadorComConta();
    deslogar();

    const url = await esperaRedirect(salvarEmailDeContato({}, formulario("intruso@example.com")));

    expect(url).toBe("/login");
    const [depois] = await db.select().from(users).where(eq(users.id, conta.id));
    expect(depois.contactEmail).toBeNull();
  });
});
