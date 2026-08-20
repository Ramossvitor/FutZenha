// O círculo do fut avulso, que decide quem entra sozinho e quem pede.
//
// A regressão que ele existe para travar apareceu no E2E antes de qualquer
// asserção: quem ORGANIZA um fut avulso não está na lista dele até clicar em
// "Vou", então uma regra que só olhasse "já esteve na lista" mandava o próprio
// organizador pedir para entrar no próprio fut.

import { describe, expect, it } from "vitest";
import { estaNoCirculoDoFut } from "@/lib/fut-entrada-db";
import { confirmarPresenca, criarFut, criarJogador } from "@/test/fixtures";

describe("estaNoCirculoDoFut", () => {
  it("quem organiza é do círculo do próprio fut", async () => {
    const dono = await criarJogador();
    const fut = await criarFut({ createdByPlayerId: dono.id });

    expect(await estaNoCirculoDoFut(fut, dono.id)).toBe(true);
  });

  it("quem já dividiu um fut com quem organiza também é", async () => {
    const dono = await criarJogador();
    const conhecido = await criarJogador();
    const anterior = await criarFut({ date: "2026-01-10" });
    await confirmarPresenca(anterior, dono);
    await confirmarPresenca(anterior, conhecido);
    const fut = await criarFut({ createdByPlayerId: dono.id });

    expect(await estaNoCirculoDoFut(fut, conhecido.id)).toBe(true);
  });

  it("estranho não é", async () => {
    const dono = await criarJogador();
    const estranho = await criarJogador();
    const fut = await criarFut({ createdByPlayerId: dono.id });

    expect(await estaNoCirculoDoFut(fut, estranho.id)).toBe(false);
  });

  // Fut órfão não tem lista de ninguém a proteger — e recusar deixaria fut
  // antigo (a FK é `set null`) inalcançável para todo mundo.
  it("fut órfão é de todo mundo", async () => {
    const qualquer = await criarJogador();
    const fut = await criarFut({ createdByPlayerId: null });

    expect(await estaNoCirculoDoFut(fut, qualquer.id)).toBe(true);
  });
});
