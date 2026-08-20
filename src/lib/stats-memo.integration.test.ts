// O memo dos agregados: ele não pode fazer o ranking mentir.
//
// Cache cuja invalidação ninguém testa é exatamente como um ranking passa a
// mostrar número velho em silêncio. Estes casos verificam as duas metades:
// que ele de fato guarda (é o ponto), e que ele solta quando o dado muda.

import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { goals } from "@/db/schema";
import { esquecerStats, getTopScorers } from "@/lib/stats";
import { criarFut, criarJogadorComConta } from "@/test/fixtures";
import { criarJogo } from "@/test/fixtures-avaliacao";

/** Um fut ENCERRADO com um gol de `autor` — o mínimo que a artilharia conta
 *  (src/lib/stats.ts só olha fut `finished` e jogador com conta ativa). */
async function futComGol() {
  const { jogador: autor } = await criarJogadorComConta();
  const { jogador: adversario } = await criarJogadorComConta();
  const fut = await criarFut({ status: "finished" });
  const jogo = await criarJogo(fut, [autor], [adversario]);
  await db.insert(goals).values({ gameId: jogo.id, playerId: autor.id, quantity: 1, side: "A" });
  return { autor, jogo };
}

describe("memo dos agregados", () => {
  it("guarda a resposta entre leituras iguais", async () => {
    const { autor } = await futComGol();
    esquecerStats();

    const antes = await getTopScorers();
    expect(antes.find((a) => a.playerId === autor.id)?.total).toBe(1);

    // Some com o gol POR FORA das actions — nada invalida o memo.
    await db.delete(goals);

    const depois = await getTopScorers();
    expect(depois.find((a) => a.playerId === autor.id)?.total).toBe(1);
  });

  it("solta quando esquecerStats é chamado", async () => {
    const { autor } = await futComGol();
    esquecerStats();

    await getTopScorers();
    await db.delete(goals);
    esquecerStats();

    const depois = await getTopScorers();
    expect(depois.find((a) => a.playerId === autor.id)).toBeUndefined();
  });

  // O escopo faz parte da chave: o recorte de um grupo não pode responder pelo
  // geral. Errar isto seria vazar número de grupo privado para quem pede o
  // ranking geral — e o contrário, que só é errado.
  it("escopos diferentes não compartilham entrada", async () => {
    const { autor } = await futComGol();
    esquecerStats();

    const geral = await getTopScorers();
    const deGrupoInexistente = await getTopScorers({ groupId: 999_999 });

    expect(geral.find((a) => a.playerId === autor.id)?.total).toBe(1);
    expect(deGrupoInexistente).toHaveLength(0);
  });

  it("anos diferentes não compartilham entrada", async () => {
    await futComGol();
    esquecerStats();

    const todos = await getTopScorers();
    const outroAno = await getTopScorers({ year: 1999 });

    expect(todos.length).toBeGreaterThan(0);
    expect(outroAno).toHaveLength(0);
  });
});
