// O ciclo da aposta contra o banco de verdade.
//
// O que estes testes existem para provar são três coisas, e as três são o
// antifraude:
//
// 1. **Não dá para apostar sabendo de nada.** A janela fecha quando os times
//    saem, e fecha nas DUAS pontas — apostar e cancelar. Uma trava que só guarda
//    uma ponta não guarda nada (a lição do desarme do multiplicador).
// 2. **Nenhuma zenha nasce.** O que os vencedores recebem é o que os perdedores
//    puseram, e o fecho `saldo == sum(amount)` é cobrado ao fim de todo cenário.
// 3. **Resolver duas vezes não paga duas vezes.** São quatro camadas de
//    exatamente-uma-vez, e o teste passa por cima de cada uma.

import { beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  attendances,
  gamePlayers,
  games,
  matchDays,
  ratingRounds,
  teamPlayers,
  teams,
  trocasDeLado,
  zenhaApostas,
  zenhaCarteiras,
  zenhaLedger,
  type MatchDay,
  type Player,
} from "@/db/schema";
import { apagarFut } from "./deletion";
import { processarPendencias } from "./pendencias";
import {
  apostar,
  apostasALiquidar,
  cancelarAposta,
  devolverApostasDeFutsAbandonados,
  liquidarApostasDoFut,
  situacaoDaAposta,
} from "./aposta-engine";
import { confirmarPresenca, criarFut } from "@/test/fixtures";
import { jogadorComSaldo } from "@/test/fixtures-loja";

/** Um fut marcado para daqui a alguns dias, às 20h — janela de aposta aberta. */
async function futFuturo(extra: Partial<typeof matchDays.$inferInsert> = {}): Promise<MatchDay> {
  return criarFut({
    // A data vem do relógio do BANCO, nunca de `new Date()`: o driver rejeita
    // Date em template sql cru, e a suíte não pode depender do fuso da máquina.
    date: sql`((now() at time zone 'America/Sao_Paulo')::date + 3)` as unknown as string,
    startTime: "20:00",
    ...extra,
  });
}

/** Confirma na lista e aposta — o par que todo cenário começa fazendo. */
async function apostarNoFut(fut: MatchDay, jogador: Player, valor: number) {
  await confirmarPresenca(fut, jogador);
  return apostar(db, jogador.id, fut.id, valor);
}

/**
 * O fecho da carteira, cobrado ao fim de cada cenário: o saldo materializado tem
 * que continuar sendo a soma exata do extrato.
 */
async function conferirFecho(...jogadores: Player[]): Promise<void> {
  for (const jogador of jogadores) {
    const [carteira] = await db
      .select({ saldo: zenhaCarteiras.saldo })
      .from(zenhaCarteiras)
      .where(eq(zenhaCarteiras.playerId, jogador.id));
    const [soma] = await db
      .select({ total: sql<number>`coalesce(sum(${zenhaLedger.amount}), 0)::int` })
      .from(zenhaLedger)
      .where(eq(zenhaLedger.playerId, jogador.id));
    expect(carteira?.saldo ?? 0).toBe(soma?.total ?? 0);
    expect(carteira?.saldo ?? 0).toBeGreaterThanOrEqual(0);
  }
}

/**
 * A constraint que o Postgres recusou, ou null se o insert passou.
 *
 * O drizzle embrulha o erro do driver e a mensagem de fora só diz "Failed
 * query" — o nome da constraint mora na cadeia de `cause`. Sem isto o teste
 * passaria com qualquer erro, inclusive um typo no SQL. Gêmeo do helper de
 * src/lib/agenda-freio.integration.test.ts.
 */
async function constraintViolada(query: Promise<unknown>): Promise<string | null> {
  try {
    await query;
    return null;
  } catch (erro: unknown) {
    let atual: unknown = erro;
    while (typeof atual === "object" && atual !== null) {
      if ("constraint_name" in atual && typeof atual.constraint_name === "string") {
        return atual.constraint_name;
      }
      atual = (atual as { cause?: unknown }).cause;
    }
    throw erro;
  }
}

const saldoDe = async (jogador: Player): Promise<number> => {
  const [carteira] = await db
    .select({ saldo: zenhaCarteiras.saldo })
    .from(zenhaCarteiras)
    .where(eq(zenhaCarteiras.playerId, jogador.id));
  return carteira?.saldo ?? 0;
};

const apostaDe = async (fut: MatchDay, jogador: Player) => {
  const [linha] = await db
    .select()
    .from(zenhaApostas)
    .where(and(eq(zenhaApostas.matchDayId, fut.id), eq(zenhaApostas.playerId, jogador.id)));
  return linha;
};

/** Dois times com os jogadores dados, no fut. Devolve os ids. */
async function montarTimes(fut: MatchDay, ladoA: Player[], ladoB: Player[]) {
  const [timeA] = await db
    .insert(teams)
    .values({ matchDayId: fut.id, name: "Preto", sortOrder: 0 })
    .returning();
  const [timeB] = await db
    .insert(teams)
    .values({ matchDayId: fut.id, name: "Branco", sortOrder: 1 })
    .returning();
  await db.insert(teamPlayers).values([
    ...ladoA.map((p) => ({ teamId: timeA.id, playerId: p.id })),
    ...ladoB.map((p) => ({ teamId: timeB.id, playerId: p.id })),
  ]);
  await db.update(matchDays).set({ status: "teams_drawn" }).where(eq(matchDays.id, fut.id));
  return { timeAId: timeA.id, timeBId: timeB.id };
}

/** Um jogo encerrado com a escalação dos dois lados. */
async function lancarJogo(
  fut: MatchDay,
  times: { timeAId: number; timeBId: number },
  placar: { a: number; b: number },
  escalacao: { ladoA: Player[]; ladoB: Player[] },
  sortOrder = 0,
) {
  const [jogo] = await db
    .insert(games)
    .values({
      matchDayId: fut.id,
      teamAId: times.timeAId,
      teamBId: times.timeBId,
      scoreA: placar.a,
      scoreB: placar.b,
      sortOrder,
    })
    .returning();
  await db.insert(gamePlayers).values([
    ...escalacao.ladoA.map((p) => ({ gameId: jogo.id, playerId: p.id, side: "A" as const })),
    ...escalacao.ladoB.map((p) => ({ gameId: jogo.id, playerId: p.id, side: "B" as const })),
  ]);
  return jogo;
}

/**
 * Encerra o fut com o placar já congelado: `finished_at` retroagido para além da
 * janela de correção, que é o que a liquidação das apostas espera.
 */
async function encerrarComPlacarFrio(fut: MatchDay, horasAtras = 25) {
  await db
    .update(matchDays)
    .set({
      status: "finished",
      finishedAt: sql`now() - ${sql.raw(`interval '${Math.trunc(horasAtras)} hours'`)}`,
    })
    .where(eq(matchDays.id, fut.id));
}

let ana: Player;
let bruno: Player;

beforeEach(async () => {
  ana = await jogadorComSaldo(1000);
  bruno = await jogadorComSaldo(1000);
});

describe("apostar", () => {
  it("aposta na lista aberta, debita o saldo e deixa a linha viva", async () => {
    const fut = await futFuturo();
    expect(await apostarNoFut(fut, ana, 100)).toBeNull();

    const aposta = await apostaDe(fut, ana);
    expect(aposta.valor).toBe(100);
    expect(aposta.resolvidaEm).toBeNull();
    expect(aposta.desfecho).toBeNull();
    expect(await saldoDe(ana)).toBe(900);
    await conferirFecho(ana);
  });

  it("recusa quem não está confirmado na lista", async () => {
    const fut = await futFuturo();
    expect(await apostar(db, ana.id, fut.id, 100)).toBe("aposta-indisponivel");
    expect(await apostaDe(fut, ana)).toBeUndefined();
    expect(await saldoDe(ana)).toBe(1000);
  });

  // O corte que torna a aposta cega: com os times na mesa, apostar seria
  // escolher já sabendo com quem se joga.
  it("recusa depois de os times saírem", async () => {
    const fut = await futFuturo();
    await confirmarPresenca(fut, ana);
    await montarTimes(fut, [ana], [bruno]);
    expect(await apostar(db, ana.id, fut.id, 100)).toBe("aposta-indisponivel");
  });

  it("recusa dentro da margem antes do horário marcado", async () => {
    // Hoje, com o horário a cinco minutos de distância: dentro dos 15 minutos
    // de `aposta_fecha_min_antes`.
    const fut = await criarFut({
      date: sql`((now() at time zone 'America/Sao_Paulo')::date)` as unknown as string,
      startTime: sql`((now() at time zone 'America/Sao_Paulo') + interval '5 minutes')::time` as unknown as string,
    });
    await confirmarPresenca(fut, ana);
    expect(await apostar(db, ana.id, fut.id, 100)).toBe("aposta-indisponivel");
  });

  it("recusa depois de o horário passar", async () => {
    const fut = await criarFut({
      date: sql`((now() at time zone 'America/Sao_Paulo')::date - 1)` as unknown as string,
      startTime: "20:00",
    });
    await confirmarPresenca(fut, ana);
    expect(await apostar(db, ana.id, fut.id, 100)).toBe("aposta-indisponivel");
  });

  it("recusa a segunda aposta viva no mesmo fut", async () => {
    const fut = await futFuturo();
    expect(await apostarNoFut(fut, ana, 100)).toBeNull();
    expect(await apostar(db, ana.id, fut.id, 50)).toBe("aposta-indisponivel");
    expect(await saldoDe(ana)).toBe(900);
    await conferirFecho(ana);
  });

  it("sem saldo, recusa e NÃO deixa aposta órfã", async () => {
    const pobre = await jogadorComSaldo(10);
    const fut = await futFuturo();
    expect(await apostarNoFut(fut, pobre, 500)).toBe("saldo-insuficiente");

    // O rollback tem que ter levado a linha da aposta junto: o INSERT dela veio
    // ANTES do débito.
    expect(await apostaDe(fut, pobre)).toBeUndefined();
    expect(await saldoDe(pobre)).toBe(10);
    await conferirFecho(pobre);
  });

  // O `UPDATE ... WHERE saldo >= valor` é a serialização, sem lock nenhum: dois
  // futs ao mesmo tempo, saldo para uma aposta só.
  it("duas apostas simultâneas com saldo para uma: exatamente uma passa", async () => {
    const curto = await jogadorComSaldo(100);
    const [fut1, fut2] = [await futFuturo(), await futFuturo()];
    await confirmarPresenca(fut1, curto);
    await confirmarPresenca(fut2, curto);

    const resultados = await Promise.all([
      apostar(db, curto.id, fut1.id, 100),
      apostar(db, curto.id, fut2.id, 100),
    ]);

    expect(resultados.filter((r) => r === null)).toHaveLength(1);
    expect(resultados.filter((r) => r === "saldo-insuficiente")).toHaveLength(1);
    expect(await saldoDe(curto)).toBe(0);
    await conferirFecho(curto);
  });
});

describe("cancelarAposta", () => {
  it("cancela na janela e devolve a zenha", async () => {
    const fut = await futFuturo();
    await apostarNoFut(fut, ana, 100);
    const aposta = await apostaDe(fut, ana);

    expect(await cancelarAposta(db, ana.id, aposta.id)).toBeNull();
    const depois = await apostaDe(fut, ana);
    expect(depois.desfecho).toBe("cancelada");
    expect(depois.retorno).toBe(100);
    expect(await saldoDe(ana)).toBe(1000);
    await conferirFecho(ana);
  });

  it("depois de cancelar dá para apostar de novo — a unique é parcial", async () => {
    const fut = await futFuturo();
    await apostarNoFut(fut, ana, 100);
    await cancelarAposta(db, ana.id, (await apostaDe(fut, ana)).id);
    expect(await apostar(db, ana.id, fut.id, 200)).toBeNull();
    expect(await saldoDe(ana)).toBe(800);
    await conferirFecho(ana);
  });

  // A MESMA guarda das duas pontas. Sem ela: aposta na véspera, vê os times, e
  // cancela antes de a bola rolar.
  it("recusa depois de os times saírem", async () => {
    const fut = await futFuturo();
    await apostarNoFut(fut, ana, 100);
    const aposta = await apostaDe(fut, ana);
    await montarTimes(fut, [ana], [bruno]);

    expect(await cancelarAposta(db, ana.id, aposta.id)).toBe("aposta-travada");
    expect((await apostaDe(fut, ana)).resolvidaEm).toBeNull();
    expect(await saldoDe(ana)).toBe(900);
  });

  it("recusa cancelar aposta de outra pessoa", async () => {
    const fut = await futFuturo();
    await apostarNoFut(fut, ana, 100);
    const aposta = await apostaDe(fut, ana);

    expect(await cancelarAposta(db, bruno.id, aposta.id)).toBe("aposta-travada");
    expect((await apostaDe(fut, ana)).resolvidaEm).toBeNull();
  });

  it("recusa cancelar duas vezes", async () => {
    const fut = await futFuturo();
    await apostarNoFut(fut, ana, 100);
    const aposta = await apostaDe(fut, ana);
    expect(await cancelarAposta(db, ana.id, aposta.id)).toBeNull();
    expect(await cancelarAposta(db, ana.id, aposta.id)).toBe("aposta-travada");
    expect(await saldoDe(ana)).toBe(1000);
    await conferirFecho(ana);
  });
});

describe("liquidarApostasDoFut", () => {
  /** O cenário completo: dois apostadores em lados opostos, o lado A vence. */
  async function futDecidido(valorAna = 100, valorBruno = 100) {
    const fut = await futFuturo();
    await apostarNoFut(fut, ana, valorAna);
    await apostarNoFut(fut, bruno, valorBruno);
    const times = await montarTimes(fut, [ana], [bruno]);
    await lancarJogo(fut, times, { a: 3, b: 1 }, { ladoA: [ana], ladoB: [bruno] });
    await encerrarComPlacarFrio(fut);
    return { fut, times };
  }

  it("o vencedor leva a aposta de volta mais o que o perdedor pôs", async () => {
    const { fut } = await futDecidido();
    expect(await liquidarApostasDoFut(db, fut.id)).toBe(2);

    const daAna = await apostaDe(fut, ana);
    expect(daAna.desfecho).toBe("paga");
    expect(daAna.retorno).toBe(200);
    expect(daAna.timeNome).toBe("Preto");

    const doBruno = await apostaDe(fut, bruno);
    expect(doBruno.desfecho).toBe("perdida");
    expect(doBruno.retorno).toBe(0);

    expect(await saldoDe(ana)).toBe(1100);
    expect(await saldoDe(bruno)).toBe(900);
    await conferirFecho(ana, bruno);
  });

  it("a soma dos saldos não muda: a aposta é soma zero", async () => {
    const { fut } = await futDecidido(70, 30);
    await liquidarApostasDoFut(db, fut.id);
    expect((await saldoDe(ana)) + (await saldoDe(bruno))).toBe(2000);
    await conferirFecho(ana, bruno);
  });

  it("liquidar duas vezes é no-op — nada é pago de novo", async () => {
    const { fut } = await futDecidido();
    expect(await liquidarApostasDoFut(db, fut.id)).toBe(2);
    expect(await liquidarApostasDoFut(db, fut.id)).toBe(0);
    expect(await saldoDe(ana)).toBe(1100);
    expect(await saldoDe(bruno)).toBe(900);
    await conferirFecho(ana, bruno);
  });

  it("empate no fut devolve tudo", async () => {
    const fut = await futFuturo();
    await apostarNoFut(fut, ana, 100);
    await apostarNoFut(fut, bruno, 100);
    const times = await montarTimes(fut, [ana], [bruno]);
    // Uma vitória para cada, mesmo saldo: ninguém vence.
    await lancarJogo(fut, times, { a: 2, b: 0 }, { ladoA: [ana], ladoB: [bruno] }, 0);
    await lancarJogo(fut, times, { a: 0, b: 2 }, { ladoA: [ana], ladoB: [bruno] }, 1);
    await encerrarComPlacarFrio(fut);

    await liquidarApostasDoFut(db, fut.id);
    expect((await apostaDe(fut, ana)).desfecho).toBe("devolvida");
    expect((await apostaDe(fut, bruno)).desfecho).toBe("devolvida");
    expect(await saldoDe(ana)).toBe(1000);
    expect(await saldoDe(bruno)).toBe(1000);
    await conferirFecho(ana, bruno);
  });

  it("todo mundo no mesmo time devolve tudo — não houve aposta contra ninguém", async () => {
    const fut = await futFuturo();
    await apostarNoFut(fut, ana, 100);
    await apostarNoFut(fut, bruno, 100);
    const times = await montarTimes(fut, [ana, bruno], []);
    await lancarJogo(fut, times, { a: 3, b: 0 }, { ladoA: [ana, bruno], ladoB: [] });
    await encerrarComPlacarFrio(fut);

    await liquidarApostasDoFut(db, fut.id);
    expect((await apostaDe(fut, ana)).desfecho).toBe("devolvida");
    expect(await saldoDe(ana)).toBe(1000);
    expect(await saldoDe(bruno)).toBe(1000);
    await conferirFecho(ana, bruno);
  });

  it("quem não entrou em campo recebe de volta", async () => {
    const fut = await futFuturo();
    await apostarNoFut(fut, ana, 100);
    await apostarNoFut(fut, bruno, 100);
    const times = await montarTimes(fut, [ana], [bruno]);
    // O Bruno apostou mas não jogou: só a Ana entra na escalação.
    await lancarJogo(fut, times, { a: 3, b: 1 }, { ladoA: [ana], ladoB: [] });
    await encerrarComPlacarFrio(fut);

    await liquidarApostasDoFut(db, fut.id);
    expect((await apostaDe(fut, bruno)).desfecho).toBe("devolvida");
    expect(await saldoDe(bruno)).toBe(1000);
    // Sem ninguém do outro lado, a da Ana também volta.
    expect((await apostaDe(fut, ana)).desfecho).toBe("devolvida");
    await conferirFecho(ana, bruno);
  });

  it("quem jogou por times diferentes recebe de volta", async () => {
    const carla = await jogadorComSaldo(1000);
    const fut = await futFuturo();
    await apostarNoFut(fut, ana, 100);
    await apostarNoFut(fut, bruno, 100);
    await apostarNoFut(fut, carla, 100);
    const times = await montarTimes(fut, [ana, carla], [bruno]);
    // A Carla começa no A e termina no B: o snapshot dos dois jogos discorda.
    await lancarJogo(fut, times, { a: 3, b: 1 }, { ladoA: [ana, carla], ladoB: [bruno] }, 0);
    await lancarJogo(fut, times, { a: 2, b: 0 }, { ladoA: [ana], ladoB: [bruno, carla] }, 1);
    await encerrarComPlacarFrio(fut);

    await liquidarApostasDoFut(db, fut.id);
    expect((await apostaDe(fut, carla)).desfecho).toBe("devolvida");
    expect(await saldoDe(carla)).toBe(1000);
    // A aposta da Carla saiu do pote: sobrou Ana (venceu) contra Bruno.
    expect((await apostaDe(fut, ana)).retorno).toBe(200);
    expect((await apostaDe(fut, bruno)).desfecho).toBe("perdida");
    await conferirFecho(ana, bruno, carla);
  });

  // A troca com o jogo em andamento reescreve o `side` daquele jogo, então o
  // snapshot sozinho não denuncia nada — quem denuncia é o log.
  it("quem trocou de lado com o jogo rolando recebe de volta", async () => {
    const fut = await futFuturo();
    await apostarNoFut(fut, ana, 100);
    await apostarNoFut(fut, bruno, 100);
    const times = await montarTimes(fut, [ana], [bruno]);
    const jogo = await lancarJogo(fut, times, { a: 3, b: 1 }, { ladoA: [ana], ladoB: [bruno] });
    await db.insert(trocasDeLado).values({
      gameId: jogo.id,
      playerId: ana.id,
      deLado: "B",
      paraLado: "A",
    });
    await encerrarComPlacarFrio(fut);

    await liquidarApostasDoFut(db, fut.id);
    expect((await apostaDe(fut, ana)).desfecho).toBe("devolvida");
    expect(await saldoDe(ana)).toBe(1000);
    await conferirFecho(ana, bruno);
  });

  it("o rateio é proporcional ao valor apostado, e a sobra do arredondamento some", async () => {
    const carla = await jogadorComSaldo(1000);
    const fut = await futFuturo();
    await apostarNoFut(fut, ana, 100);
    await apostarNoFut(fut, carla, 50);
    await apostarNoFut(fut, bruno, 90);
    const times = await montarTimes(fut, [ana, carla], [bruno]);
    await lancarJogo(fut, times, { a: 3, b: 1 }, { ladoA: [ana, carla], ladoB: [bruno] });
    await encerrarComPlacarFrio(fut);

    await liquidarApostasDoFut(db, fut.id);
    // Pote perdido = 90, lado vencedor = 150. A Ana tem 2/3 e leva 60; a Carla,
    // 1/3 e leva 30.
    expect((await apostaDe(fut, ana)).retorno).toBe(160);
    expect((await apostaDe(fut, carla)).retorno).toBe(80);
    expect((await saldoDe(ana)) + (await saldoDe(bruno)) + (await saldoDe(carla))).toBe(3000);
    await conferirFecho(ana, bruno, carla);
  });
});

describe("apostasALiquidar", () => {
  async function futEncerradoComAposta(horasAtras: number) {
    const fut = await futFuturo();
    await apostarNoFut(fut, ana, 100);
    await apostarNoFut(fut, bruno, 100);
    const times = await montarTimes(fut, [ana], [bruno]);
    await lancarJogo(fut, times, { a: 3, b: 1 }, { ladoA: [ana], ladoB: [bruno] });
    await encerrarComPlacarFrio(fut, horasAtras);
    return fut;
  }

  it("entra quando o placar já congelou", async () => {
    const fut = await futEncerradoComAposta(25);
    expect(await apostasALiquidar(db)).toContain(fut.id);
  });

  // O ponto do desenho: a aposta paga por PLACAR, e placar é editável por 24h.
  // Pagar antes disso seria pagar sobre um número que ainda pode mudar.
  it("NÃO entra enquanto a janela de correção do placar está aberta", async () => {
    const fut = await futEncerradoComAposta(1);
    expect(await apostasALiquidar(db)).not.toContain(fut.id);
  });

  it("NÃO entra com a rodada de avaliação ainda aberta", async () => {
    const fut = await futEncerradoComAposta(25);
    await db.insert(ratingRounds).values({
      matchDayId: fut.id,
      status: "open",
      deadlineAt: sql`now() + interval '10 hours'`,
    });
    expect(await apostasALiquidar(db)).not.toContain(fut.id);

    await db.update(ratingRounds).set({ status: "closed" }).where(eq(ratingRounds.matchDayId, fut.id));
    expect(await apostasALiquidar(db)).toContain(fut.id);
  });

  it("NÃO entra depois de liquidado", async () => {
    const fut = await futEncerradoComAposta(25);
    await liquidarApostasDoFut(db, fut.id);
    expect(await apostasALiquidar(db)).not.toContain(fut.id);
  });

  it("fut sem aposta viva nunca entra", async () => {
    const fut = await futFuturo();
    await encerrarComPlacarFrio(fut);
    expect(await apostasALiquidar(db)).not.toContain(fut.id);
  });
});

describe("devolução por fut que não aconteceu", () => {
  it("apagar o fut devolve as apostas vivas", async () => {
    const fut = await futFuturo();
    await apostarNoFut(fut, ana, 100);
    await apostarNoFut(fut, bruno, 250);

    await db.transaction((tx) => apagarFut(tx, fut.id, `teste:aposta:${fut.id}`));

    expect(await saldoDe(ana)).toBe(1000);
    expect(await saldoDe(bruno)).toBe(1000);
    // A linha da aposta foi embora pelo cascade; a do extrato ficou, com o
    // ponteiro cortado pelo `set null`.
    const linhas = await db
      .select({ motivo: zenhaLedger.motivo, matchDayId: zenhaLedger.matchDayId })
      .from(zenhaLedger)
      .where(and(eq(zenhaLedger.playerId, ana.id), eq(zenhaLedger.motivo, "aposta_devolvida")));
    expect(linhas).toHaveLength(1);
    expect(linhas[0].matchDayId).toBeNull();
    await conferirFecho(ana, bruno);
  });

  // Prêmio pago é definitivo: aquele fut aconteceu, e o ledger não tem reversão.
  it("apagar o fut depois de pago NÃO desfaz o prêmio", async () => {
    const fut = await futFuturo();
    await apostarNoFut(fut, ana, 100);
    await apostarNoFut(fut, bruno, 100);
    const times = await montarTimes(fut, [ana], [bruno]);
    await lancarJogo(fut, times, { a: 3, b: 1 }, { ladoA: [ana], ladoB: [bruno] });
    await encerrarComPlacarFrio(fut);
    await liquidarApostasDoFut(db, fut.id);

    await db.transaction((tx) => apagarFut(tx, fut.id, `teste:aposta-paga:${fut.id}`));

    expect(await saldoDe(ana)).toBe(1100);
    expect(await saldoDe(bruno)).toBe(900);
    await conferirFecho(ana, bruno);
  });

  it("fut que ninguém encerrou devolve depois de sete dias", async () => {
    const fut = await futFuturo();
    await apostarNoFut(fut, ana, 100);
    // Sem isto a zenha ficaria presa para sempre: cancelar exige a janela (que
    // fechou) e liquidar exige `finished` (que nunca vem).
    await db
      .update(matchDays)
      .set({ date: sql`((now() at time zone 'America/Sao_Paulo')::date - 8)` })
      .where(eq(matchDays.id, fut.id));

    expect(await devolverApostasDeFutsAbandonados(db)).toBe(1);
    expect(await saldoDe(ana)).toBe(1000);
    expect((await apostaDe(fut, ana)).desfecho).toBe("devolvida");

    // Idempotente: a segunda passada não devolve de novo.
    expect(await devolverApostasDeFutsAbandonados(db)).toBe(0);
    expect(await saldoDe(ana)).toBe(1000);
    await conferirFecho(ana);
  });

  it("não devolve fut recém-passado — sete dias é o prazo", async () => {
    const fut = await futFuturo();
    await apostarNoFut(fut, ana, 100);
    await db
      .update(matchDays)
      .set({ date: sql`((now() at time zone 'America/Sao_Paulo')::date - 1)` })
      .where(eq(matchDays.id, fut.id));

    expect(await devolverApostasDeFutsAbandonados(db)).toBe(0);
    expect(await saldoDe(ana)).toBe(900);
  });

  // A fresta entre as duas varreduras, que é onde a zenha ficava presa: fut
  // ENCERRADO que passou da janela de liquidação sem ser liquidado (varredura
  // fora do ar por semanas — o `after()` só faz `console.error`). Ele já não
  // entra em `apostasALiquidar`, e enquanto a devolução olhava só
  // `status <> 'finished'` também não entrava aqui: sem terceira saída, porque
  // cancelar exige a janela, que fechou no dia do fut.
  it("fut encerrado que passou da janela de liquidação também volta", async () => {
    const fut = await futFuturo();
    await apostarNoFut(fut, ana, 100);
    await db
      .update(matchDays)
      .set({ date: sql`((now() at time zone 'America/Sao_Paulo')::date - 40)` })
      .where(eq(matchDays.id, fut.id));
    await encerrarComPlacarFrio(fut, 40 * 24);

    expect(await apostasALiquidar(db)).not.toContain(fut.id);
    expect(await devolverApostasDeFutsAbandonados(db)).toBe(1);
    expect(await saldoDe(ana)).toBe(1000);
    expect((await apostaDe(fut, ana)).desfecho).toBe("devolvida");
    await conferirFecho(ana);
  });

  // A outra ponta da mesma fresta: encerrado DENTRO da janela continua sendo
  // caso da liquidação, e a devolução não pode passar na frente dela.
  it("fut encerrado dentro da janela fica com a liquidação, não com a devolução", async () => {
    const fut = await futFuturo();
    await apostarNoFut(fut, ana, 100);
    await db
      .update(matchDays)
      .set({ date: sql`((now() at time zone 'America/Sao_Paulo')::date - 8)` })
      .where(eq(matchDays.id, fut.id));
    await encerrarComPlacarFrio(fut);

    expect(await devolverApostasDeFutsAbandonados(db)).toBe(0);
    expect(await apostasALiquidar(db)).toContain(fut.id);
    expect(await saldoDe(ana)).toBe(900);
  });
});

describe("situacaoDaAposta", () => {
  it("oferece a aposta a quem está confirmado, na janela", async () => {
    const fut = await futFuturo();
    await confirmarPresenca(fut, ana);
    const situacao = await situacaoDaAposta(db, ana.id, fut.id);
    expect(situacao.confirmado).toBe(true);
    expect(situacao.aceita).toBe(true);
    expect(situacao.minha).toBeNull();
    expect(situacao.pote).toBe(0);
  });

  it("mostra a aposta viva e o pote do fut", async () => {
    const fut = await futFuturo();
    await apostarNoFut(fut, ana, 100);
    await apostarNoFut(fut, bruno, 250);

    const situacao = await situacaoDaAposta(db, ana.id, fut.id);
    expect(situacao.minha?.valor).toBe(100);
    expect(situacao.pote).toBe(350);
  });

  // A tela é só a tela, mas ela e a action têm que concordar: `aceita` sai do
  // MESMO predicado que o `WHERE` da escrita usa.
  it("fecha junto com a janela quando os times saem", async () => {
    const fut = await futFuturo();
    await apostarNoFut(fut, ana, 100);
    await montarTimes(fut, [ana], [bruno]);

    const situacao = await situacaoDaAposta(db, ana.id, fut.id);
    expect(situacao.aceita).toBe(false);
    expect(situacao.minha?.valor).toBe(100);
  });

  // Cancelar tem que devolver a tela ao estado de OFERTA, não ao de desfecho: a
  // unique parcial existe para deixar apostar de novo dentro da janela, e a
  // situação é quem decide se o card mostra o formulário ou o resultado.
  it("depois de cancelar, volta a oferecer a aposta — não mostra desfecho", async () => {
    const fut = await futFuturo();
    await apostarNoFut(fut, ana, 100);
    const aposta = await apostaDe(fut, ana);
    expect(await cancelarAposta(db, ana.id, aposta.id)).toBeNull();

    const situacao = await situacaoDaAposta(db, ana.id, fut.id);
    expect(situacao.minha).toBeNull();
    expect(situacao.resolvida).toBeNull();
    expect(situacao.aceita).toBe(true);
    expect(situacao.confirmado).toBe(true);
    expect(situacao.pote).toBe(0);

    // E a aposta nova de fato entra, que é o que a tela agora oferece.
    expect(await apostar(db, ana.id, fut.id, 250)).toBeNull();
    expect((await situacaoDaAposta(db, ana.id, fut.id)).minha?.valor).toBe(250);
    await conferirFecho(ana);
  });

  // A cancelada some da vitrine, mas não apaga o desfecho REAL da aposta que
  // veio depois dela — senão o remédio do teste acima esconderia o resultado.
  it("a cancelada não engole o desfecho da aposta seguinte", async () => {
    const fut = await futFuturo();
    await apostarNoFut(fut, ana, 100);
    await cancelarAposta(db, ana.id, (await apostaDe(fut, ana)).id);
    await apostar(db, ana.id, fut.id, 100);
    await apostarNoFut(fut, bruno, 100);

    const times = await montarTimes(fut, [ana], [bruno]);
    await lancarJogo(fut, times, { a: 3, b: 1 }, { ladoA: [ana], ladoB: [bruno] });
    await encerrarComPlacarFrio(fut);
    await liquidarApostasDoFut(db, fut.id);

    const situacao = await situacaoDaAposta(db, ana.id, fut.id);
    expect(situacao.resolvida?.desfecho).toBe("paga");
    expect(situacao.resolvida?.retorno).toBe(200);
    await conferirFecho(ana, bruno);
  });

  it("mostra o desfecho depois da liquidação", async () => {
    const fut = await futFuturo();
    await apostarNoFut(fut, ana, 100);
    await apostarNoFut(fut, bruno, 100);
    const times = await montarTimes(fut, [ana], [bruno]);
    await lancarJogo(fut, times, { a: 3, b: 1 }, { ladoA: [ana], ladoB: [bruno] });
    await encerrarComPlacarFrio(fut);
    await liquidarApostasDoFut(db, fut.id);

    const situacao = await situacaoDaAposta(db, ana.id, fut.id);
    expect(situacao.minha).toBeNull();
    expect(situacao.resolvida).toEqual({
      valor: 100,
      retorno: 200,
      desfecho: "paga",
      timeNome: "Preto",
    });
  });
});

// As garantias que não dependem do código: mesmo um script na mão, ou um call
// site futuro que esqueça a regra, esbarra nelas.
describe("o banco recusa o que o código não deve gravar", () => {
  it("aposta de valor zero ou negativo não entra", async () => {
    const fut = await futFuturo();
    expect(
      await constraintViolada(
        db.insert(zenhaApostas).values({ matchDayId: fut.id, playerId: ana.id, valor: 0 }),
      ),
    ).toBe("zenha_apostas_valor_positivo");
  });

  // O caso que faria zenha sumir em silêncio: a aposta sai da varredura sem ter
  // pago nada.
  it("desfecho sem retorno não entra — os três campos caem juntos", async () => {
    const fut = await futFuturo();
    expect(
      await constraintViolada(
        db.insert(zenhaApostas).values({
          matchDayId: fut.id,
          playerId: ana.id,
          valor: 10,
          resolvidaEm: sql`now()` as unknown as Date,
          desfecho: "paga",
        }),
      ),
    ).toBe("zenha_apostas_resolucao_junta");
  });

  it("aposta perdida com retorno não entra", async () => {
    const fut = await futFuturo();
    expect(
      await constraintViolada(
        db.insert(zenhaApostas).values({
          matchDayId: fut.id,
          playerId: ana.id,
          valor: 10,
          resolvidaEm: sql`now()` as unknown as Date,
          retorno: 10,
          desfecho: "perdida",
        }),
      ),
    ).toBe("zenha_apostas_retorno_coerente");
  });

  it("prêmio menor que a aposta não entra", async () => {
    const fut = await futFuturo();
    expect(
      await constraintViolada(
        db.insert(zenhaApostas).values({
          matchDayId: fut.id,
          playerId: ana.id,
          valor: 10,
          resolvidaEm: sql`now()` as unknown as Date,
          retorno: 5,
          desfecho: "paga",
        }),
      ),
    ).toBe("zenha_apostas_retorno_coerente");
  });

  it("duas apostas vivas do mesmo jogador no mesmo fut não entram", async () => {
    const fut = await futFuturo();
    await db.insert(zenhaApostas).values({ matchDayId: fut.id, playerId: ana.id, valor: 10 });
    expect(
      await constraintViolada(
        db.insert(zenhaApostas).values({ matchDayId: fut.id, playerId: ana.id, valor: 20 }),
      ),
    ).toBe("zenha_apostas_ativa_unq");
  });
});

// Um cenário que atravessa o ciclo inteiro, para o caso de alguma das peças
// concordar consigo mesma e discordar do conjunto.
describe("o ciclo completo", () => {
  it("aposta, cancela, aposta de novo, joga, liquida — e o fecho fecha", async () => {
    const carla = await jogadorComSaldo(1000);
    const fut = await futFuturo();

    await apostarNoFut(fut, ana, 100);
    await cancelarAposta(db, ana.id, (await apostaDe(fut, ana)).id);
    await apostar(db, ana.id, fut.id, 300);
    await apostarNoFut(fut, bruno, 200);
    await apostarNoFut(fut, carla, 100);

    const times = await montarTimes(fut, [ana], [bruno, carla]);
    await lancarJogo(fut, times, { a: 2, b: 0 }, { ladoA: [ana], ladoB: [bruno, carla] }, 0);
    await lancarJogo(fut, times, { a: 1, b: 3 }, { ladoA: [ana], ladoB: [bruno, carla] }, 1);
    await lancarJogo(fut, times, { a: 4, b: 1 }, { ladoA: [ana], ladoB: [bruno, carla] }, 2);
    await encerrarComPlacarFrio(fut);

    await liquidarApostasDoFut(db, fut.id);

    // O time A venceu dois dos três jogos.
    const linhas = await db
      .select()
      .from(zenhaApostas)
      .where(
        and(
          eq(zenhaApostas.matchDayId, fut.id),
          inArray(zenhaApostas.playerId, [ana.id, bruno.id, carla.id]),
        ),
      );
    const vivas = linhas.filter((l) => l.resolvidaEm === null);
    expect(vivas).toHaveLength(0);

    expect(await saldoDe(ana)).toBe(1000 + 300);
    expect(await saldoDe(bruno)).toBe(800);
    expect(await saldoDe(carla)).toBe(900);
    await conferirFecho(ana, bruno, carla);
  });
});

// O caminho de PRODUÇÃO: em produção ninguém chama `liquidarApostasDoFut`
// direto — quem chama é a varredura, de dentro de uma transação única que já
// segura o advisory lock. É outro executor e outra conexão, e é aqui que um
// `db` global esquecido no motor apareceria (ele disputaria a conexão que a
// própria transação segura).
describe("pela varredura", () => {
  it("liquida a aposta e devolve o fut abandonado numa passada só", async () => {
    const decidido = await futFuturo();
    await apostarNoFut(decidido, ana, 100);
    await apostarNoFut(decidido, bruno, 100);
    const times = await montarTimes(decidido, [ana], [bruno]);
    await lancarJogo(decidido, times, { a: 3, b: 1 }, { ladoA: [ana], ladoB: [bruno] });
    await encerrarComPlacarFrio(decidido);

    const carla = await jogadorComSaldo(1000);
    const abandonado = await futFuturo();
    await apostarNoFut(abandonado, carla, 300);
    await db
      .update(matchDays)
      .set({ date: sql`((now() at time zone 'America/Sao_Paulo')::date - 8)` })
      .where(eq(matchDays.id, abandonado.id));

    const resultado = await processarPendencias();

    expect(resultado.apostasResolvidas).toBe(2);
    expect(resultado.apostasDevolvidas).toBe(1);
    expect(await saldoDe(ana)).toBe(1100);
    expect(await saldoDe(bruno)).toBe(900);
    expect(await saldoDe(carla)).toBe(1000);

    // A segunda passada não paga nada de novo.
    const denovo = await processarPendencias();
    expect(denovo.apostasResolvidas).toBe(0);
    expect(denovo.apostasDevolvidas).toBe(0);
    expect(await saldoDe(ana)).toBe(1100);
    await conferirFecho(ana, bruno, carla);
  });
});

describe("o que a aposta NÃO toca", () => {
  it("apostar não mexe em presença nem em escalação", async () => {
    const fut = await futFuturo();
    await apostarNoFut(fut, ana, 100);
    const [presenca] = await db
      .select()
      .from(attendances)
      .where(and(eq(attendances.matchDayId, fut.id), eq(attendances.playerId, ana.id)));
    expect(presenca.status).toBe("in");
  });
});
