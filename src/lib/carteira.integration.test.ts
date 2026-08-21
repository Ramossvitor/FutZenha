// A carteira contra o banco de verdade. Três coisas aqui não têm como ser
// testadas fora dele, e são exatamente as três que quebram em produção:
//
// 1. duas linhas do mesmo jogador no mesmo lote (participação + nota do mesmo
//    fut) sem estourar o "ON CONFLICT DO UPDATE command cannot affect row a
//    second time";
// 2. duas compras simultâneas com saldo para uma só, serializadas pelo
//    `UPDATE ... WHERE saldo >= $valor RETURNING` — sem lock nenhum;
// 3. o fecho `saldo == sum(amount)`, que é o preço de o saldo ser materializado
//    em vez de derivado. Ele é cobrado ao fim de TODO cenário.

import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { zenhaCarteiras, zenhaInventario, zenhaLedger, type Player } from "@/db/schema";
import { creditar, debitar, garantirCarteira, getExtrato, getSaldo } from "@/lib/carteira";
import type { CreditoDeZenha } from "@/lib/zenha";
import { criarJogador } from "@/test/fixtures";

/**
 * O fecho da carteira. É o invariante que o desenho materializado tem que pagar:
 * o saldo é uma cópia da soma do extrato, e no minuto em que os dois divergem o
 * extrato deixa de explicar o saldo.
 */
async function conferirFecho(jogador: Player): Promise<number> {
  const [carteira] = await db
    .select({ saldo: zenhaCarteiras.saldo })
    .from(zenhaCarteiras)
    .where(eq(zenhaCarteiras.playerId, jogador.id));
  const [soma] = await db
    .select({ total: sql<number>`coalesce(sum(${zenhaLedger.amount}), 0)::int` })
    .from(zenhaLedger)
    .where(eq(zenhaLedger.playerId, jogador.id));

  const saldo = carteira?.saldo ?? 0;
  expect(saldo).toBe(soma?.total ?? 0);
  expect(saldo).toBeGreaterThanOrEqual(0);
  return saldo;
}

async function linhasDoLedger(jogador: Player) {
  return db
    .select()
    .from(zenhaLedger)
    .where(eq(zenhaLedger.playerId, jogador.id))
    .orderBy(zenhaLedger.id);
}

/** As duas linhas que um fut de verdade gera para o mesmo jogador. */
function creditosDoMesmoFut(jogador: Player, matchDayId = 1): CreditoDeZenha[] {
  return [
    {
      playerId: jogador.id,
      motivo: "participacao",
      amount: 100,
      dedupeKey: `participacao:fut:${matchDayId}`,
      descricao: "Participação no fut de 12/08",
    },
    {
      playerId: jogador.id,
      motivo: "nota",
      amount: 40,
      dedupeKey: `nota:fut:${matchDayId}`,
      descricao: "Sua nota subiu 0,1 no fut de 12/08",
    },
  ];
}

describe("garantirCarteira", () => {
  it("cria a carteira ZERADA — boas-vindas é assunto de quem credita", async () => {
    const jogador = await criarJogador();

    await garantirCarteira(db, jogador.id);

    expect(await getSaldo(jogador.id)).toBe(0);
    expect(await linhasDoLedger(jogador)).toHaveLength(0);
    await conferirFecho(jogador);
  });

  it("chamar de novo não zera o saldo de quem já tinha", async () => {
    const jogador = await criarJogador();
    await creditar(db, creditosDoMesmoFut(jogador));

    await garantirCarteira(db, jogador.id);

    expect(await getSaldo(jogador.id)).toBe(140);
    await conferirFecho(jogador);
  });
});

describe("creditar", () => {
  // ESTE é o teste que justifica a agregação por jogador antes do upsert: sem
  // ela, o Postgres recusa o comando inteiro com "cannot affect row a second
  // time" — e este lote é o lote NORMAL de uma liquidação, não um caso de borda.
  it("duas linhas do mesmo jogador no mesmo lote somam, sem estourar o ON CONFLICT", async () => {
    const jogador = await criarJogador();

    await creditar(db, creditosDoMesmoFut(jogador));

    expect(await getSaldo(jogador.id)).toBe(140);
    expect(await linhasDoLedger(jogador)).toHaveLength(2);
    await conferirFecho(jogador);
  });

  it("credita vários jogadores no mesmo lote", async () => {
    const [a, b] = [await criarJogador(), await criarJogador()];

    await creditar(db, [...creditosDoMesmoFut(a), ...creditosDoMesmoFut(b)]);

    expect(await getSaldo(a.id)).toBe(140);
    expect(await getSaldo(b.id)).toBe(140);
    await conferirFecho(a);
    await conferirFecho(b);
  });

  // A idempotência é da unique (player_id, dedupe_key): o varredor pode passar
  // duas vezes pelo mesmo fut. Se o saldo saísse do que foi PEDIDO em vez do que
  // ENTROU, a segunda passada pagaria tudo de novo.
  it("repetir o mesmo lote não paga em dobro e não move o saldo", async () => {
    const jogador = await criarJogador();
    const lote = creditosDoMesmoFut(jogador);
    await creditar(db, lote);

    await creditar(db, lote);

    expect(await getSaldo(jogador.id)).toBe(140);
    expect(await linhasDoLedger(jogador)).toHaveLength(2);
    await conferirFecho(jogador);
  });

  it("no lote misto, só a linha nova soma", async () => {
    const jogador = await criarJogador();
    await creditar(db, creditosDoMesmoFut(jogador));

    await creditar(db, [
      ...creditosDoMesmoFut(jogador),
      {
        playerId: jogador.id,
        motivo: "mvp",
        amount: 150,
        dedupeKey: "mvp:fut:1",
        descricao: "Melhor em campo no fut de 12/08",
      },
    ]);

    expect(await getSaldo(jogador.id)).toBe(290);
    expect(await linhasDoLedger(jogador)).toHaveLength(3);
    await conferirFecho(jogador);
  });

  it("lote vazio é no-op", async () => {
    await expect(creditar(db, [])).resolves.toBeUndefined();
    expect(await db.select().from(zenhaCarteiras)).toHaveLength(0);
  });

  // Crédito não-positivo é bug de quem montou o lote, e o lote inteiro cai por
  // causa dele: um amount negativo aqui debitaria sem passar pelo `saldo >=
  // valor` da compra, e só o zero teria o `check (amount <> 0)` para segurá-lo.
  it("crédito não-positivo lança e não escreve nada do lote", async () => {
    const jogador = await criarJogador();

    await expect(
      creditar(db, [
        ...creditosDoMesmoFut(jogador),
        {
          playerId: jogador.id,
          motivo: "mvp",
          amount: -150,
          dedupeKey: "mvp:fut:1",
          descricao: "Melhor em campo no fut de 12/08",
        },
      ]),
    ).rejects.toThrow(/Crédito inválido/);

    expect(await linhasDoLedger(jogador)).toHaveLength(0);
    expect(await conferirFecho(jogador)).toBe(0);
  });

  it("congela a descrição e o motivo na linha do extrato", async () => {
    const jogador = await criarJogador();

    await creditar(db, [
      {
        playerId: jogador.id,
        motivo: "boas_vindas",
        amount: 320,
        dedupeKey: "boas-vindas",
        descricao: "Boas-vindas ao FutZenha",
      },
    ]);

    const [linha] = await linhasDoLedger(jogador);
    expect(linha.motivo).toBe("boas_vindas");
    expect(linha.amount).toBe(320);
    expect(linha.descricao).toBe("Boas-vindas ao FutZenha");
    await conferirFecho(jogador);
  });
});

describe("debitar", () => {
  it("com saldo, devolve o saldo novo e grava a linha NEGATIVA", async () => {
    const jogador = await criarJogador();
    await creditar(db, creditosDoMesmoFut(jogador));

    const saldo = await debitar(db, jogador.id, 90, "compra:1", "Badge do Artilheiro");

    expect(saldo).toBe(50);
    expect(await getSaldo(jogador.id)).toBe(50);
    const linhas = await linhasDoLedger(jogador);
    expect(linhas).toHaveLength(3);
    expect(linhas[2].amount).toBe(-90);
    expect(linhas[2].motivo).toBe("compra");
    expect(linhas[2].descricao).toBe("Badge do Artilheiro");
    await conferirFecho(jogador);
  });

  it("amarra a linha do extrato ao item comprado", async () => {
    const jogador = await criarJogador();
    await creditar(db, creditosDoMesmoFut(jogador));
    const [item] = await db
      .insert(zenhaInventario)
      .values({ playerId: jogador.id, itemId: "badge_artilheiro", precoPago: 90 })
      .returning();

    await debitar(db, jogador.id, 90, `compra:${item.id}`, "Badge do Artilheiro", {
      inventarioId: item.id,
    });

    const linhas = await linhasDoLedger(jogador);
    expect(linhas[2].inventarioId).toBe(item.id);
    await conferirFecho(jogador);
  });

  it("sem saldo, devolve null e não escreve nada", async () => {
    const jogador = await criarJogador();
    await creditar(db, creditosDoMesmoFut(jogador));

    const saldo = await debitar(db, jogador.id, 141, "compra:1", "Moldura de Ouro");

    expect(saldo).toBeNull();
    expect(await getSaldo(jogador.id)).toBe(140);
    expect(await linhasDoLedger(jogador)).toHaveLength(2);
    await conferirFecho(jogador);
  });

  // O limite exato: gastar tudo passa (é `>=`, não `>`), e a carteira fica em 0
  // sem encostar no check do banco.
  it("gastar o saldo inteiro passa e zera a carteira", async () => {
    const jogador = await criarJogador();
    await creditar(db, creditosDoMesmoFut(jogador));

    expect(await debitar(db, jogador.id, 140, "compra:1", "Título raro")).toBe(0);
    expect(await conferirFecho(jogador)).toBe(0);
  });

  it("jogador que nunca teve carteira compra normalmente — ela nasce no débito", async () => {
    const jogador = await criarJogador();
    await creditar(db, [
      {
        playerId: jogador.id,
        motivo: "boas_vindas",
        amount: 320,
        dedupeKey: "boas-vindas",
        descricao: "Boas-vindas ao FutZenha",
      },
    ]);

    expect(await debitar(db, jogador.id, 120, "compra:1", "Multiplicador")).toBe(200);
    await conferirFecho(jogador);
  });

  it("carteira inexistente não vira saldo do nada", async () => {
    const jogador = await criarJogador();

    expect(await debitar(db, jogador.id, 10, "compra:1", "Badge")).toBeNull();
    expect(await conferirFecho(jogador)).toBe(0);
  });

  // Valor não-positivo é bug de quem chamou, não compra recusada — e falhar alto
  // é o que impede um "débito" negativo de creditar sem passar por regra nenhuma.
  it("valor não-positivo lança", async () => {
    const jogador = await criarJogador();

    await expect(debitar(db, jogador.id, 0, "compra:1", "Badge")).rejects.toThrow(
      /Débito inválido/,
    );
    await expect(debitar(db, jogador.id, -50, "compra:2", "Badge")).rejects.toThrow(
      /Débito inválido/,
    );
    await conferirFecho(jogador);
  });

  // A recusa do `onConflictDoNothing` no insert do ledger só é defensável se a
  // linha do extrato e o desconto da carteira caírem JUNTOS. Este é o cenário em
  // que eles se separam sem crash nenhum: a mesma chave de compra duas vezes.
  // Sem a transação em volta, o UPDATE da carteira já committou quando a unique
  // estoura — e o extrato passa a dever 50 zenhas que ninguém consegue explicar.
  it("chave de compra repetida estoura e NÃO deixa o saldo divergir do extrato", async () => {
    const jogador = await criarJogador();
    await creditar(db, creditosDoMesmoFut(jogador));
    await debitar(db, jogador.id, 50, "compra:1", "Badge do Artilheiro");

    await expect(debitar(db, jogador.id, 50, "compra:1", "Badge do Artilheiro")).rejects.toThrow();

    expect(await getSaldo(jogador.id)).toBe(90);
    expect(await linhasDoLedger(jogador)).toHaveLength(3);
    expect(await conferirFecho(jogador)).toBe(90);
  });

  // O coração do desenho: nenhum lock, nenhum FOR UPDATE. As duas transações
  // disputam a MESMA linha da carteira; a segunda espera o commit da primeira,
  // reavalia o `saldo >= valor` sobre o valor já debitado e volta com zero
  // linhas. Se qualquer uma tivesse passado por engano, o `check (saldo >= 0)`
  // teria derrubado a transação — e o Promise.all abaixo rejeitaria.
  it("duas compras concorrentes com saldo para uma só: exatamente uma passa", async () => {
    const jogador = await criarJogador();
    await creditar(db, [
      {
        playerId: jogador.id,
        motivo: "boas_vindas",
        amount: 100,
        dedupeKey: "boas-vindas",
        descricao: "Boas-vindas ao FutZenha",
      },
    ]);

    const resultados = await Promise.all([
      db.transaction((tx) => debitar(tx, jogador.id, 100, "compra:1", "Badge do Artilheiro")),
      db.transaction((tx) => debitar(tx, jogador.id, 100, "compra:2", "Moldura de Ouro")),
    ]);

    expect(resultados.filter((r) => r !== null)).toEqual([0]);
    expect(await getSaldo(jogador.id)).toBe(0);
    expect(await linhasDoLedger(jogador)).toHaveLength(2);
    expect(await conferirFecho(jogador)).toBe(0);
  });

  it("duas compras concorrentes com saldo para as duas passam as duas", async () => {
    const jogador = await criarJogador();
    await creditar(db, [
      {
        playerId: jogador.id,
        motivo: "boas_vindas",
        amount: 320,
        dedupeKey: "boas-vindas",
        descricao: "Boas-vindas ao FutZenha",
      },
    ]);

    const resultados = await Promise.all([
      db.transaction((tx) => debitar(tx, jogador.id, 100, "compra:1", "Badge do Artilheiro")),
      db.transaction((tx) => debitar(tx, jogador.id, 120, "compra:2", "Multiplicador")),
    ]);

    expect(resultados.every((r) => r !== null)).toBe(true);
    expect(await conferirFecho(jogador)).toBe(100);
  });
});

describe("getExtrato", () => {
  it("pagina de 50 em 50", async () => {
    const jogador = await criarJogador();
    // Um lote só: todas as linhas com o MESMO created_at, que é o cenário real
    // da liquidação e o que obriga o desempate por id na ordenação.
    await creditar(
      db,
      Array.from({ length: 60 }, (_, i) => ({
        playerId: jogador.id,
        motivo: "participacao" as const,
        amount: i + 1,
        dedupeKey: `participacao:fut:${i + 1}`,
        descricao: `Participação no fut ${i + 1}`,
      })),
    );

    const primeira = await getExtrato(jogador.id);
    const segunda = await getExtrato(jogador.id, 1);

    expect(primeira.linhas).toHaveLength(50);
    expect(primeira.temMais).toBe(true);
    expect(segunda.linhas).toHaveLength(10);
    expect(segunda.temMais).toBe(false);

    // As duas páginas cobrem tudo, sem repetir e sem furo, e na ordem do mais
    // recente para o mais antigo — com created_at empatado, quem desempata é o id.
    const ids = [...primeira.linhas, ...segunda.linhas].map((l) => l.id);
    expect(new Set(ids).size).toBe(60);
    expect(ids).toEqual([...ids].sort((a, b) => b - a));
    await conferirFecho(jogador);
  });

  it("página além do fim vem vazia", async () => {
    const jogador = await criarJogador();
    await creditar(db, creditosDoMesmoFut(jogador));

    expect(await getExtrato(jogador.id, 1)).toEqual({ linhas: [], temMais: false });
  });

  // `?p=abc` vira NaN em quem lê o parâmetro, e NaN atravessa Math.max/Math.trunc
  // intacto: sem a checagem de finitude ele chegava ao `offset` e derrubava a
  // query em vez de mostrar o começo do extrato.
  it("página que não é número volta para a primeira", async () => {
    const jogador = await criarJogador();
    await creditar(db, creditosDoMesmoFut(jogador));

    const lixo = await getExtrato(jogador.id, Number.NaN);

    expect(lixo.linhas).toHaveLength(2);
    expect(lixo).toEqual(await getExtrato(jogador.id, 0));
  });

  it("extrato de quem nunca movimentou é vazio", async () => {
    const jogador = await criarJogador();

    expect(await getExtrato(jogador.id)).toEqual({ linhas: [], temMais: false });
    expect(await getSaldo(jogador.id)).toBe(0);
  });

  it("não mistura o extrato de dois jogadores", async () => {
    const [a, b] = [await criarJogador(), await criarJogador()];
    await creditar(db, [...creditosDoMesmoFut(a), ...creditosDoMesmoFut(b)]);

    const extrato = await getExtrato(a.id);

    expect(extrato.linhas).toHaveLength(2);
    expect(extrato.linhas.every((l) => l.playerId === a.id)).toBe(true);
  });
});
