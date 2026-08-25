// A fronteira das actions da aposta.
//
// O ciclo (apostar, cancelar, a janela, a liquidação) está travado em
// src/lib/aposta-engine.integration.test.ts. O que sobra aqui é a casca — e ela
// importa: o valor e os ids chegam pelo corpo do POST, e Server Action é
// endpoint público. O que se prova aqui é que valor absurdo, aposta alheia e
// chamada sem sessão viram BANNER, nunca página de erro nem zenha movida.

import { describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { zenhaApostas, type MatchDay, type Player } from "@/db/schema";
import { apostarAction, cancelarApostaAction } from "@/app/(esqueleto)/fut/[id]/aposta-actions";
import {
  confirmarPresenca,
  criarFut,
  criarJogadorComConta,
  deslogar,
  logarComo,
} from "@/test/fixtures";
import { esperaRedirect } from "@/test/navigation-fake";
import { creditar } from "@/lib/carteira";
import { apostar } from "@/lib/aposta-engine";
import { AJUSTES } from "@/lib/zenha";

/** Um fut marcado para daqui a alguns dias — dentro da janela da aposta. */
const futFuturo = (): Promise<MatchDay> =>
  criarFut({
    date: sql`((now() at time zone 'America/Sao_Paulo')::date + 3)` as unknown as string,
    startTime: "20:00",
  });

/** Jogador logado, com saldo e já confirmado na lista do fut. */
async function jogadorPronto(fut: MatchDay, saldo = 1000): Promise<Player> {
  const { jogador, conta } = await criarJogadorComConta();
  await logarComo(conta);
  if (saldo > 0) {
    await creditar(db, [
      {
        playerId: jogador.id,
        motivo: "boas_vindas",
        amount: saldo,
        dedupeKey: "boas-vindas",
        descricao: "Boas-vindas ao FutZenha",
      },
    ]);
  }
  await confirmarPresenca(fut, jogador);
  return jogador;
}

const formDeAposta = (valor: unknown): FormData => {
  const form = new FormData();
  form.set("valor", String(valor));
  return form;
};

const apostaDe = async (fut: MatchDay, jogador: Player) => {
  const [linha] = await db
    .select()
    .from(zenhaApostas)
    .where(and(eq(zenhaApostas.matchDayId, fut.id), eq(zenhaApostas.playerId, jogador.id)));
  return linha;
};

describe("apostarAction", () => {
  it("aposta e volta para o fut com o aviso", async () => {
    const fut = await futFuturo();
    const jogador = await jogadorPronto(fut);

    const url = await esperaRedirect(apostarAction(fut.id, formDeAposta(100)));

    expect(url).toBe(`/fut/${fut.id}?ok=aposta-feita`);
    expect((await apostaDe(fut, jogador)).valor).toBe(100);
  });

  it("deslogado vai para o login e não aposta nada", async () => {
    const fut = await futFuturo();
    const jogador = await jogadorPronto(fut);
    deslogar();

    expect(await esperaRedirect(apostarAction(fut.id, formDeAposta(100)))).toBe("/login");
    expect(await apostaDe(fut, jogador)).toBeUndefined();
  });

  it("quem não está na lista recebe o banner, sem aposta", async () => {
    const fut = await futFuturo();
    const { conta } = await criarJogadorComConta();
    await logarComo(conta);

    expect(await esperaRedirect(apostarAction(fut.id, formDeAposta(100)))).toBe(
      `/fut/${fut.id}?erro=aposta-indisponivel`,
    );
  });

  // `safeParse`, e não `parse`: um valor forjado tem que virar o banner de
  // sempre — com `parse` a action LANÇARIA, e o que a pessoa veria é a página de
  // erro do Next.
  it("valor absurdo vira dados-invalidos, sem estourar", async () => {
    const fut = await futFuturo();
    const jogador = await jogadorPronto(fut);

    for (const valor of [-1, 0, "abc", "", 1.5]) {
      expect(await esperaRedirect(apostarAction(fut.id, formDeAposta(valor)))).toBe(
        `/fut/${fut.id}?erro=dados-invalidos`,
      );
    }
    expect(await esperaRedirect(apostarAction(-5, formDeAposta(10)))).toBe(
      "/fut/-5?erro=dados-invalidos",
    );
    expect(await apostaDe(fut, jogador)).toBeUndefined();
  });

  it("valor fora do limite tem banner próprio — o genérico não diria qual é o teto", async () => {
    const fut = await futFuturo();
    const jogador = await jogadorPronto(fut, 200000);

    expect(
      await esperaRedirect(
        apostarAction(fut.id, formDeAposta(AJUSTES.aposta_min.padrao - 1)),
      ),
    ).toBe(`/fut/${fut.id}?erro=aposta-fora-do-limite`);
    expect(
      await esperaRedirect(
        apostarAction(fut.id, formDeAposta(AJUSTES.aposta_max.padrao + 1)),
      ),
    ).toBe(`/fut/${fut.id}?erro=aposta-fora-do-limite`);
    expect(await apostaDe(fut, jogador)).toBeUndefined();
  });

  it("sem saldo vira o banner da loja, e nada é escrito", async () => {
    const fut = await futFuturo();
    const jogador = await jogadorPronto(fut, 10);

    expect(await esperaRedirect(apostarAction(fut.id, formDeAposta(500)))).toBe(
      `/fut/${fut.id}?erro=sem-saldo`,
    );
    expect(await apostaDe(fut, jogador)).toBeUndefined();
  });
});

describe("cancelarApostaAction", () => {
  it("cancela e volta para o fut com o aviso", async () => {
    const fut = await futFuturo();
    const jogador = await jogadorPronto(fut);
    await apostar(db, jogador.id, fut.id, 100);
    const aposta = await apostaDe(fut, jogador);

    const url = await esperaRedirect(cancelarApostaAction(fut.id, aposta.id));

    expect(url).toBe(`/fut/${fut.id}?ok=aposta-cancelada`);
    expect((await apostaDe(fut, jogador)).desfecho).toBe("cancelada");
  });

  // O id da aposta alheia no corpo do POST é a primeira coisa que alguém tenta.
  // O dono é reconferido no `WHERE`, contra o player da SESSÃO.
  it("aposta de outra pessoa é recusada", async () => {
    const fut = await futFuturo();
    const alheio = await jogadorPronto(fut);
    await apostar(db, alheio.id, fut.id, 100);
    const doAlheio = await apostaDe(fut, alheio);
    await jogadorPronto(fut); // agora quem está logado é outro

    const url = await esperaRedirect(cancelarApostaAction(fut.id, doAlheio.id));

    expect(url).toBe(`/fut/${fut.id}?erro=aposta-travada`);
    expect((await apostaDe(fut, alheio)).resolvidaEm).toBeNull();
  });

  it("id absurdo vira dados-invalidos, sem estourar", async () => {
    const fut = await futFuturo();
    await jogadorPronto(fut);

    expect(await esperaRedirect(cancelarApostaAction(fut.id, -1))).toBe(
      `/fut/${fut.id}?erro=dados-invalidos`,
    );
  });
});
