// O alvo aqui é o `temConta`: é ele que decide o selo "sem conta" no perfil e
// o texto que explica por que os números vêm zerados (as funções de ./stats
// fazem innerJoin em users ativo). As três formas de não ter conta — nenhuma,
// desativada, e a normal — precisam cair no lado certo.

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { users } from "@/db/schema";
import { criarJogador, criarJogadorComConta } from "@/test/fixtures";
import { getJogador } from "./jogadores";

describe("getJogador", () => {
  it("devolve a linha do jogador com temConta quando a conta está ativa", async () => {
    const { jogador } = await criarJogadorComConta();

    const perfil = await getJogador(jogador.id);

    expect(perfil).toMatchObject({
      id: jogador.id,
      name: jogador.name,
      skill: jogador.skill,
      active: true,
      temConta: true,
    });
  });

  it("jogador sem conta nenhuma tem perfil, com temConta false", async () => {
    const jogador = await criarJogador();

    const perfil = await getJogador(jogador.id);

    expect(perfil?.id).toBe(jogador.id);
    expect(perfil?.temConta).toBe(false);
  });

  it("conta desativada conta como sem conta", async () => {
    const { jogador, conta } = await criarJogadorComConta();
    await db.update(users).set({ active: false }).where(eq(users.id, conta.id));

    const perfil = await getJogador(jogador.id);

    expect(perfil?.temConta).toBe(false);
  });

  it("jogador fora das listas continua tendo perfil", async () => {
    const { jogador } = await criarJogadorComConta({ active: false });

    const perfil = await getJogador(jogador.id);

    expect(perfil?.active).toBe(false);
  });

  it("id inexistente devolve undefined", async () => {
    expect(await getJogador(999_999)).toBeUndefined();
  });
});
