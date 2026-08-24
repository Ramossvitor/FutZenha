// Teste-fumaça do harness de integração: se isto passa, o banco de teste
// existe e está migrado, o truncate isola os testes, os mocks de next/* valem e
// o caminho real de sessão (token assinado + validação no banco) funciona.

import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { players } from "@/db/schema";
import { getSession } from "@/lib/session";
import { criarJogadorComConta, logarComo } from "./fixtures";

describe("harness de integração", () => {
  it("insere e lê no banco de teste", async () => {
    const [jogador] = await db.insert(players).values({ name: "Fumaça", slug: "fumaca" }).returning();
    const lidos = await db.select().from(players);
    expect(lidos).toHaveLength(1);
    expect(lidos[0].id).toBe(jogador.id);
    expect(lidos[0].skill).toBe(5);
  });

  it("começa cada teste com o banco limpo (truncate do beforeEach)", async () => {
    const lidos = await db.select().from(players);
    expect(lidos).toHaveLength(0);
  });

  it("logarComo cria sessão que o getSession valida no banco", async () => {
    const { jogador, conta } = await criarJogadorComConta();
    await logarComo(conta);

    const sessao = await getSession();
    expect(sessao).not.toBeNull();
    expect(sessao?.userId).toBe(conta.id);
    expect(sessao?.player.id).toBe(jogador.id);
    expect(sessao?.isPlatformAdmin).toBe(false);
  });

  it("sem cookie, getSession devolve null", async () => {
    const sessao = await getSession();
    expect(sessao).toBeNull();
  });
});
