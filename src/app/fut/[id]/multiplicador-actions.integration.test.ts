// A fronteira das actions do multiplicador.
//
// O ciclo (armar, desarmar, o corte, o congelamento) está travado em
// multiplicador-engine.integration.test.ts. O que sobra aqui é a casca — e ela
// importa mais do que a média: `inventarioId` e `matchDayId` chegam pelo
// `.bind`, ou seja, no corpo do POST. Server Action é endpoint público, então o
// que se prova aqui é que id alheio, id absurdo e chamada sem sessão viram
// BANNER, e nunca uma página de erro nem um arme que não devia existir.

import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { matchDays, zenhaInventario, type MatchDay, type Player } from "@/db/schema";
import { armarMultiplicador, desarmarMultiplicador } from "@/app/fut/[id]/actions";
import { AJUSTES } from "@/lib/zenha";
import { criarFut, criarJogadorComConta, deslogar, logarComo } from "@/test/fixtures";
import { garantirMultiplicador } from "@/test/fixtures-loja";
import { esperaRedirect } from "@/test/navigation-fake";

/** Um fut marcado para daqui a alguns dias — dentro da janela do arme. */
const futFuturo = (): Promise<MatchDay> =>
  criarFut({
    date: sql`((now() at time zone 'America/Sao_Paulo')::date + 3)` as unknown as string,
    startTime: "20:00",
  });

async function multiplicadorDe(jogador: Player): Promise<number> {
  // A linha do consumível nasce na migration, mas o truncate do beforeEach a
  // leva junto — daí a fixture. Ver src/test/fixtures-loja.ts.
  const daLoja = await garantirMultiplicador();
  const [item] = await db
    .insert(zenhaInventario)
    .values({
      playerId: jogador.id,
      itemId: daLoja.id,
      precoPago: 120,
      consumivel: true,
      fatorPercent: AJUSTES.multiplicador_fator.padrao,
    })
    .returning({ id: zenhaInventario.id });
  return item.id;
}

async function jogadorLogadoComMultiplicador() {
  const { jogador, conta } = await criarJogadorComConta();
  await logarComo(conta);
  return { jogador, conta, inventarioId: await multiplicadorDe(jogador) };
}

const armeDe = async (inventarioId: number) => {
  const [linha] = await db
    .select({ matchDayId: zenhaInventario.armadoMatchDayId })
    .from(zenhaInventario)
    .where(eq(zenhaInventario.id, inventarioId));
  return linha.matchDayId;
};

describe("armarMultiplicador", () => {
  it("arma e volta para o fut com o aviso", async () => {
    const { inventarioId } = await jogadorLogadoComMultiplicador();
    const fut = await futFuturo();

    const url = await esperaRedirect(armarMultiplicador(fut.id, inventarioId));

    expect(url).toBe(`/fut/${fut.id}?ok=multiplicador-armado`);
    expect(await armeDe(inventarioId)).toBe(fut.id);
  });

  it("deslogado vai para o login e não arma nada", async () => {
    const { inventarioId } = await jogadorLogadoComMultiplicador();
    const fut = await futFuturo();
    deslogar();

    const url = await esperaRedirect(armarMultiplicador(fut.id, inventarioId));

    expect(url).toBe("/login");
    expect(await armeDe(inventarioId)).toBeNull();
  });

  // O id do item alheio no corpo do POST é a primeira coisa que alguém tenta. A
  // posse é reconferida no `WHERE` de `armar`, contra o player da SESSÃO.
  it("multiplicador de outra pessoa é recusado", async () => {
    const alheio = await jogadorLogadoComMultiplicador();
    await jogadorLogadoComMultiplicador(); // agora quem está logado é outro
    const fut = await futFuturo();

    const url = await esperaRedirect(armarMultiplicador(fut.id, alheio.inventarioId));

    expect(url).toBe(`/fut/${fut.id}?erro=multiplicador-indisponivel`);
    expect(await armeDe(alheio.inventarioId)).toBeNull();
  });

  // `safeParse`, e não `parse`: um id negativo forjado tem que virar o banner de
  // sempre. Com `parse` a action LANÇAVA, e o que a pessoa via era a página de
  // erro do Next.
  it("id absurdo vira dados-invalidos, sem estourar", async () => {
    await jogadorLogadoComMultiplicador();
    const fut = await futFuturo();

    expect(await esperaRedirect(armarMultiplicador(fut.id, -1))).toBe(
      `/fut/${fut.id}?erro=dados-invalidos`,
    );
    expect(await esperaRedirect(armarMultiplicador(fut.id, 0))).toBe(
      `/fut/${fut.id}?erro=dados-invalidos`,
    );
    expect(await esperaRedirect(armarMultiplicador(-5, 1))).toBe(
      "/fut/-5?erro=dados-invalidos",
    );
  });

  // Dois multiplicadores no mesmo fut estouravam a unique parcial como EXCEÇÃO
  // — 500 num POST forjado. A recusa agora sai pelo `WHERE`, como resposta.
  it("segundo multiplicador no mesmo fut é recusado com banner, não com 500", async () => {
    const { jogador, inventarioId } = await jogadorLogadoComMultiplicador();
    const segundo = await multiplicadorDe(jogador);
    const fut = await futFuturo();
    await esperaRedirect(armarMultiplicador(fut.id, inventarioId));

    const url = await esperaRedirect(armarMultiplicador(fut.id, segundo));

    expect(url).toBe(`/fut/${fut.id}?erro=multiplicador-indisponivel`);
    expect(await armeDe(segundo)).toBeNull();
  });

  it("fut que já começou recusa", async () => {
    const { inventarioId } = await jogadorLogadoComMultiplicador();
    const fut = await criarFut({
      date: sql`((now() at time zone 'America/Sao_Paulo')::date - 1)` as unknown as string,
      startTime: "20:00",
    });

    const url = await esperaRedirect(armarMultiplicador(fut.id, inventarioId));

    expect(url).toBe(`/fut/${fut.id}?erro=multiplicador-indisponivel`);
    expect(await armeDe(inventarioId)).toBeNull();
  });
});

describe("desarmarMultiplicador", () => {
  it("desarma e devolve o item ao inventário", async () => {
    const { inventarioId } = await jogadorLogadoComMultiplicador();
    const fut = await futFuturo();
    await esperaRedirect(armarMultiplicador(fut.id, inventarioId));

    const url = await esperaRedirect(desarmarMultiplicador(fut.id, inventarioId));

    expect(url).toBe(`/fut/${fut.id}?ok=multiplicador-desarmado`);
    expect(await armeDe(inventarioId)).toBeNull();
  });

  // A MESMA guarda de prazo do armar, e é o ponto do antiabuso: sem ela dá para
  // armar na véspera, jogar mal, e desarmar antes de o admin encerrar.
  it("depois de a bola rolar, não desarma mais", async () => {
    const { inventarioId } = await jogadorLogadoComMultiplicador();
    const fut = await futFuturo();
    await esperaRedirect(armarMultiplicador(fut.id, inventarioId));
    // O fut passou a ser ontem, com o arme já feito.
    await db
      .update(matchDays)
      .set({ date: sql`((now() at time zone 'America/Sao_Paulo')::date - 1)` })
      .where(eq(matchDays.id, fut.id));

    const url = await esperaRedirect(desarmarMultiplicador(fut.id, inventarioId));

    expect(url).toBe(`/fut/${fut.id}?erro=multiplicador-travado`);
    expect(await armeDe(inventarioId)).toBe(fut.id);
  });

  it("deslogado vai para o login e o arme fica de pé", async () => {
    const { inventarioId } = await jogadorLogadoComMultiplicador();
    const fut = await futFuturo();
    await esperaRedirect(armarMultiplicador(fut.id, inventarioId));
    deslogar();

    expect(await esperaRedirect(desarmarMultiplicador(fut.id, inventarioId))).toBe("/login");
    expect(await armeDe(inventarioId)).toBe(fut.id);
  });

  it("id absurdo vira dados-invalidos", async () => {
    await jogadorLogadoComMultiplicador();
    const fut = await futFuturo();

    expect(await esperaRedirect(desarmarMultiplicador(fut.id, -1))).toBe(
      `/fut/${fut.id}?erro=dados-invalidos`,
    );
  });
});
