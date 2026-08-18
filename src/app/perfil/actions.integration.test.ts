import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { ratingReports, ratingRounds, ratings, users } from "@/db/schema";
import { denunciarAvaliacao, salvarEmailDeContato } from "@/app/perfil/actions";
import { criarFut, criarJogadorComConta, deslogar, logarComo } from "@/test/fixtures";
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

describe("denunciarAvaliacao", () => {
  // Dos prazos convertidos para horas, o do admin foi o único que mudou de
  // duração (3 dias → 48h) — este teste congela o valor gravado no INSERT.
  it("grava o prazo de resposta do admin em 48 horas", async () => {
    const denunciante = await criarJogadorComConta();
    const avaliadorA = await criarJogadorComConta();
    const avaliadorB = await criarJogadorComConta();
    const fut = await criarFut({ status: "finished" });
    const [rodada] = await db
      .insert(ratingRounds)
      .values({
        matchDayId: fut.id,
        status: "closed",
        deadlineAt: sql`now() - interval '2 days'`,
        closedAt: sql`now() - interval '1 day'`,
        reportDeadlineAt: sql`now() + interval '1 hour'`,
        closeReason: "todos_avaliaram",
      })
      .returning();
    // Duas notas recebidas: o mínimo que MIN_AVALIACOES_PARA_DENUNCIAR exige.
    await db.insert(ratings).values([
      {
        roundId: rodada.id,
        raterPlayerId: avaliadorA.jogador.id,
        ratedPlayerId: denunciante.jogador.id,
        stars: 1,
      },
      {
        roundId: rodada.id,
        raterPlayerId: avaliadorB.jogador.id,
        ratedPlayerId: denunciante.jogador.id,
        stars: 2,
      },
    ]);

    await logarComo(denunciante.conta);
    const fd = new FormData();
    fd.set("reason", "Nunca joguei tão bem para levar uma estrela");
    expect(await denunciarAvaliacao(rodada.id, 0, {}, fd)).toEqual({ success: true });

    const [denuncia] = await db
      .select({
        // arredondado no banco: o prazo nasce de now() no INSERT, então aqui
        // ele já correu alguns milissegundos
        horasDePrazo: sql<number>`round(extract(epoch from (
          ${ratingReports.adminDeadlineAt} - now()
        )) / 3600)::int`,
      })
      .from(ratingReports);
    expect(denuncia.horasDePrazo).toBe(48);
  });
});
