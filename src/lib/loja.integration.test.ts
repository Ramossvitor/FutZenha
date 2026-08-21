// A loja contra o banco de verdade. O que não tem como ser testado fora dele é
// exatamente o que quebra dinheiro:
//
// 1. o `onConflictDoNothing` sobre o índice PARCIAL de `zenha_inventario` — o
//    predicado tem que ser inferido, senão o Postgres recusa o comando inteiro;
// 2. a escada do multiplicador contada por `date_trunc('month', now())`, que é
//    o relógio do BANCO e não o do runner;
// 3. o `onConflictDoUpdate` na PK `(player_id, slot)`, que é o "um por slot";
// 4. o fecho `saldo == sum(zenha_ledger.amount)`, cobrado ao fim de TODO
//    cenário. É o preço de o saldo ser materializado, e no minuto em que os dois
//    divergem o extrato deixa de explicar o saldo.

import { describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  zenhaCarteiras,
  zenhaConfig,
  zenhaEquipados,
  zenhaInventario,
  zenhaLedger,
  type Player,
} from "@/db/schema";
import { creditar } from "@/lib/carteira";
import { comprar, desequipar, equipar, getInventario, getVitrine } from "@/lib/loja";
import { CATALOGO, ID_DO_MULTIPLICADOR, chaveDePreco } from "@/lib/loja-catalogo";
import { AJUSTES, precoDoMultiplicador } from "@/lib/zenha";
import { criarJogadorComConta } from "@/test/fixtures";

/** Um cosmético qualquer, mas nomeado: o teste fala do preço dele o tempo todo. */
const BADGE = "dono-da-bola";
const OUTRO_BADGE = "perna-de-pau";
const MOLDURA = "moldura-de-ouro";

const BASE_DO_MULTIPLICADOR = AJUSTES.multiplicador_preco_base.padrao;

/**
 * O fecho da carteira. Chamado ao fim de cada cenário — é o invariante que o
 * saldo materializado tem que pagar.
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

/** Jogador logável com saldo de estreia, que é a única forma de zenha entrar. */
async function jogadorCom(saldo: number): Promise<Player> {
  const { jogador } = await criarJogadorComConta();
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
  return jogador;
}

async function linhasDoInventario(jogador: Player) {
  return db
    .select()
    .from(zenhaInventario)
    .where(eq(zenhaInventario.playerId, jogador.id))
    .orderBy(zenhaInventario.id);
}

async function comprasNoLedger(jogador: Player) {
  return db
    .select()
    .from(zenhaLedger)
    .where(and(eq(zenhaLedger.playerId, jogador.id), eq(zenhaLedger.motivo, "compra")))
    .orderBy(zenhaLedger.id);
}

describe("comprar", () => {
  it("debita o preço e entrega o item", async () => {
    const jogador = await jogadorCom(1000);

    expect(await comprar(jogador.id, BADGE)).toBeNull();

    const inventario = await linhasDoInventario(jogador);
    expect(inventario).toHaveLength(1);
    expect(inventario[0].itemId).toBe(BADGE);
    // O preço fica CONGELADO na linha: o admin mexe amanhã e o que ela pagou
    // continua sendo o que ela pagou.
    expect(inventario[0].precoPago).toBe(CATALOGO[BADGE].preco);
    expect(inventario[0].consumivel).toBe(false);
    expect(inventario[0].fatorPercent).toBeNull();

    const [compra] = await comprasNoLedger(jogador);
    expect(compra.amount).toBe(-CATALOGO[BADGE].preco);
    // A chave usa o id da linha do INVENTÁRIO, nunca o do item.
    expect(compra.dedupeKey).toBe(`compra:${inventario[0].id}`);
    expect(compra.inventarioId).toBe(inventario[0].id);

    expect(await conferirFecho(jogador)).toBe(1000 - CATALOGO[BADGE].preco);
  });

  // Sem saldo NADA acontece: o insert do inventário já rodou quando o débito
  // recusa, e é o rollback da transação que o desfaz. Sem ele o item sairia de
  // graça — o defeito mais caro que uma loja pode ter.
  it("sem saldo, não debita e NÃO entrega", async () => {
    const jogador = await jogadorCom(10);

    expect(await comprar(jogador.id, BADGE)).toBe("sem-saldo");

    expect(await linhasDoInventario(jogador)).toHaveLength(0);
    expect(await comprasNoLedger(jogador)).toHaveLength(0);
    expect(await conferirFecho(jogador)).toBe(10);
  });

  // O corte é ANTES do débito, e é ele que impede o segundo clique de cobrar por
  // um item que a pessoa já tem.
  it("o mesmo cosmético duas vezes cobra UMA vez", async () => {
    const jogador = await jogadorCom(1000);
    expect(await comprar(jogador.id, BADGE)).toBeNull();

    expect(await comprar(jogador.id, BADGE)).toBe("ja-possui");

    expect(await linhasDoInventario(jogador)).toHaveLength(1);
    expect(await comprasNoLedger(jogador)).toHaveLength(1);
    expect(await conferirFecho(jogador)).toBe(1000 - CATALOGO[BADGE].preco);
  });

  // A escada existe porque o multiplicador é o único item recomprável: sem ela,
  // quem tem saldo compraria um por semana e ele deixaria de ser uma aposta.
  it("o multiplicador duas vezes cobra as DUAS, e a segunda mais cara", async () => {
    const jogador = await jogadorCom(1000);
    const primeiro = precoDoMultiplicador(BASE_DO_MULTIPLICADOR, 0);
    const segundo = precoDoMultiplicador(BASE_DO_MULTIPLICADOR, 1);
    expect(segundo).toBeGreaterThan(primeiro);

    expect(await comprar(jogador.id, ID_DO_MULTIPLICADOR)).toBeNull();
    expect(await comprar(jogador.id, ID_DO_MULTIPLICADOR)).toBeNull();

    const inventario = await linhasDoInventario(jogador);
    expect(inventario).toHaveLength(2);
    expect(inventario.map((i) => i.precoPago)).toEqual([primeiro, segundo]);

    const compras = await comprasNoLedger(jogador);
    expect(compras.map((c) => c.amount)).toEqual([-primeiro, -segundo]);
    // Duas chaves diferentes — com `compra:{itemId}` a segunda seria engolida
    // pela unique e o item sairia de graça.
    expect(new Set(compras.map((c) => c.dedupeKey)).size).toBe(2);

    expect(await conferirFecho(jogador)).toBe(1000 - primeiro - segundo);
  });

  it("a vitrine mostra o degrau em que o jogador está, não o de tabela", async () => {
    const jogador = await jogadorCom(1000);
    await comprar(jogador.id, ID_DO_MULTIPLICADOR);

    const vitrine = await getVitrine(jogador.id);
    const naVitrine = vitrine.itens.find((i) => i.item.id === ID_DO_MULTIPLICADOR);

    expect(vitrine.multiplicadoresNoMes).toBe(1);
    expect(naVitrine?.preco).toBe(precoDoMultiplicador(BASE_DO_MULTIPLICADOR, 1));
    await conferirFecho(jogador);
  });

  it("o multiplicador congela o fator vigente, e mudar o ajuste depois não o altera", async () => {
    const jogador = await jogadorCom(1000);
    await db.insert(zenhaConfig).values({ chave: "multiplicador_fator", valor: 200 });

    expect(await comprar(jogador.id, ID_DO_MULTIPLICADOR)).toBeNull();

    // O admin baixa a força DEPOIS da compra: o que ela comprou continua 2×.
    await db
      .update(zenhaConfig)
      .set({ valor: 125 })
      .where(eq(zenhaConfig.chave, "multiplicador_fator"));

    const [comprado] = await linhasDoInventario(jogador);
    expect(comprado.fatorPercent).toBe(200);
    expect(comprado.consumivel).toBe(true);
    await conferirFecho(jogador);
  });

  it("preço sobrescrito em zenha_config é o que se cobra", async () => {
    const jogador = await jogadorCom(1000);
    await db.insert(zenhaConfig).values({ chave: chaveDePreco(MOLDURA), valor: 15 });

    expect(await comprar(jogador.id, MOLDURA)).toBeNull();

    const [comprado] = await linhasDoInventario(jogador);
    expect(comprado.precoPago).toBe(15);
    expect((await comprasNoLedger(jogador))[0].amount).toBe(-15);
    expect(await conferirFecho(jogador)).toBe(985);
  });

  // O mínimo do preço de item é 0 no painel do admin, e o ledger tem
  // `check (amount <> 0)`: mandar isso ao débito derrubaria a compra inteira.
  // Item de graça entra sem linha no extrato, e o fecho continua de pé.
  it("preço zerado entrega o item sem linha no extrato", async () => {
    const jogador = await jogadorCom(100);
    await db.insert(zenhaConfig).values({ chave: chaveDePreco(MOLDURA), valor: 0 });

    expect(await comprar(jogador.id, MOLDURA)).toBeNull();

    expect(await linhasDoInventario(jogador)).toHaveLength(1);
    expect(await comprasNoLedger(jogador)).toHaveLength(0);
    expect(await conferirFecho(jogador)).toBe(100);
  });

  // Duas compras do mesmo cosmético ao mesmo tempo: uma entrega, a outra bate na
  // unique parcial e volta com "ja-possui" — sem cobrar duas vezes.
  it("duas compras concorrentes do mesmo cosmético cobram uma só", async () => {
    const jogador = await jogadorCom(1000);

    const resultados = await Promise.all([
      comprar(jogador.id, BADGE),
      comprar(jogador.id, BADGE),
    ]);

    expect(resultados.filter((r) => r === null)).toHaveLength(1);
    expect(await linhasDoInventario(jogador)).toHaveLength(1);
    expect(await comprasNoLedger(jogador)).toHaveLength(1);
    expect(await conferirFecho(jogador)).toBe(1000 - CATALOGO[BADGE].preco);
  });

  // O consumível é o caminho SEM índice para se apoiar — ele é recomprável de
  // propósito —, e é justamente ele que tem preço em escada. O cosmético acima
  // é serializado pela unique parcial; aqui quem serializa é o `LOCK_COMPRA`,
  // e sem ele as duas compras leem `count(*) = 0` e pagam as duas o primeiro
  // degrau: dois multiplicadores pelo preço de um e meio.
  //
  // HONESTIDADE SOBRE O QUE ESTE TESTE PROVA: o `Promise.all` não garante que
  // as duas transações se sobreponham na janela certa — no harness elas quase
  // sempre acabam serializando sozinhas, e o teste passa mesmo sem o lock. A
  // corrida foi confirmada à mão, atrasando 300ms entre a leitura da escada e o
  // débito: sem o lock as duas pagam 120, com ele pagam 120 e 160. O que fica
  // aqui é a trava da ESCADA (duas compras, dois degraus) e uma chance de pegar
  // a corrida sob carga — não uma prova determinística dela.
  it("duas compras concorrentes do multiplicador cobram os DOIS degraus", async () => {
    const jogador = await jogadorCom(1000);
    const primeiro = precoDoMultiplicador(BASE_DO_MULTIPLICADOR, 0);
    const segundo = precoDoMultiplicador(BASE_DO_MULTIPLICADOR, 1);

    const resultados = await Promise.all([
      comprar(jogador.id, ID_DO_MULTIPLICADOR),
      comprar(jogador.id, ID_DO_MULTIPLICADOR),
    ]);

    // As duas passam — recomprar é o comportamento esperado. O que não pode é
    // as duas saírem pelo mesmo preço.
    expect(resultados).toEqual([null, null]);
    const inventario = await linhasDoInventario(jogador);
    expect(inventario.map((i) => i.precoPago).sort((a, b) => a - b)).toEqual([primeiro, segundo]);
    expect(await conferirFecho(jogador)).toBe(1000 - primeiro - segundo);
  });
});

describe("equipar", () => {
  it("troca o item do slot sem deixar dois", async () => {
    const jogador = await jogadorCom(1000);
    await comprar(jogador.id, BADGE);
    await comprar(jogador.id, OUTRO_BADGE);
    const [primeiro, segundo] = await linhasDoInventario(jogador);

    expect(await equipar(jogador.id, primeiro.id)).toBeNull();
    expect(await equipar(jogador.id, segundo.id)).toBeNull();

    const equipados = await db
      .select()
      .from(zenhaEquipados)
      .where(eq(zenhaEquipados.playerId, jogador.id));
    expect(equipados).toHaveLength(1);
    expect(equipados[0].slot).toBe("badge");
    expect(equipados[0].inventarioId).toBe(segundo.id);
    await conferirFecho(jogador);
  });

  it("slots diferentes convivem", async () => {
    const jogador = await jogadorCom(1000);
    await comprar(jogador.id, BADGE);
    await comprar(jogador.id, MOLDURA);
    const [oBadge, aMoldura] = await linhasDoInventario(jogador);

    await equipar(jogador.id, oBadge.id);
    await equipar(jogador.id, aMoldura.id);

    const inventario = await getInventario(jogador.id);
    const porItem = new Map(inventario.map((i) => [i.item.id, i.equipadoEm]));
    expect(porItem.get(BADGE)).toBe("badge");
    expect(porItem.get(MOLDURA)).toBe("moldura");
    await conferirFecho(jogador);
  });

  // O `player_id` está no WHERE da leitura: id de outra pessoa não vira
  // cosmético no perfil de quem mandou o POST.
  it("item de outra pessoa não faz nada", async () => {
    const dono = await jogadorCom(1000);
    const intruso = await jogadorCom(1000);
    await comprar(dono.id, BADGE);
    const [doDono] = await linhasDoInventario(dono);

    expect(await equipar(intruso.id, doDono.id)).toBe("item-nao-e-seu");

    expect(await db.select().from(zenhaEquipados)).toHaveLength(0);
    await conferirFecho(dono);
    await conferirFecho(intruso);
  });

  // O consumível não se pendura no perfil: ele se arma num fut.
  it("multiplicador não equipa", async () => {
    const jogador = await jogadorCom(1000);
    await comprar(jogador.id, ID_DO_MULTIPLICADOR);
    const [oItem] = await linhasDoInventario(jogador);

    expect(await equipar(jogador.id, oItem.id)).toBe("item-nao-e-seu");

    expect(await db.select().from(zenhaEquipados)).toHaveLength(0);
    await conferirFecho(jogador);
  });

  it("desequipar esvazia só o slot pedido, e repetir não estoura", async () => {
    const jogador = await jogadorCom(1000);
    await comprar(jogador.id, BADGE);
    await comprar(jogador.id, MOLDURA);
    const [oBadge, aMoldura] = await linhasDoInventario(jogador);
    await equipar(jogador.id, oBadge.id);
    await equipar(jogador.id, aMoldura.id);

    await desequipar(jogador.id, "badge");
    await desequipar(jogador.id, "badge");

    const equipados = await db
      .select()
      .from(zenhaEquipados)
      .where(eq(zenhaEquipados.playerId, jogador.id));
    expect(equipados).toHaveLength(1);
    expect(equipados[0].inventarioId).toBe(aMoldura.id);
    await conferirFecho(jogador);
  });

  it("desequipar não alcança o slot de outra pessoa", async () => {
    const dono = await jogadorCom(1000);
    const intruso = await jogadorCom(1000);
    await comprar(dono.id, BADGE);
    const [doDono] = await linhasDoInventario(dono);
    await equipar(dono.id, doDono.id);

    await desequipar(intruso.id, "badge");

    expect(await db.select().from(zenhaEquipados)).toHaveLength(1);
    await conferirFecho(dono);
  });
});

describe("getVitrine e getInventario", () => {
  it("a vitrine marca o que já é dele e traz o saldo", async () => {
    const jogador = await jogadorCom(1000);
    await comprar(jogador.id, BADGE);

    const vitrine = await getVitrine(jogador.id);

    expect(vitrine.saldo).toBe(1000 - CATALOGO[BADGE].preco);
    expect(vitrine.itens.find((i) => i.item.id === BADGE)?.possui).toBe(true);
    expect(vitrine.itens.find((i) => i.item.id === OUTRO_BADGE)?.possui).toBe(false);
    // O consumível NUNCA aparece como possuído: ele é recomprável.
    expect(vitrine.itens.find((i) => i.item.id === ID_DO_MULTIPLICADOR)?.possui).toBe(false);
    await conferirFecho(jogador);
  });

  it("o inventário de quem nunca comprou é vazio", async () => {
    const jogador = await jogadorCom(1000);

    expect(await getInventario(jogador.id)).toEqual([]);
    await conferirFecho(jogador);
  });

  it("o inventário não mistura o de dois jogadores", async () => {
    const a = await jogadorCom(1000);
    const b = await jogadorCom(1000);
    await comprar(a.id, BADGE);
    await comprar(b.id, MOLDURA);

    const inventario = await getInventario(a.id);

    expect(inventario).toHaveLength(1);
    expect(inventario[0].item.id).toBe(BADGE);
    await conferirFecho(a);
    await conferirFecho(b);
  });

  // O `item_id` é text SEM FK — o catálogo é código. Um id que ele não conhece
  // tem que morrer CALADO: o preço de a regra "nunca apagar entrada" ser
  // quebrada um dia é um item que sumiu da lista, nunca a página em 500.
  it("o inventário ignora o item que o catálogo não conhece", async () => {
    const jogador = await jogadorCom(1000);
    await comprar(jogador.id, BADGE);
    await db
      .insert(zenhaInventario)
      .values({ playerId: jogador.id, itemId: "item-que-nao-existe-mais", precoPago: 10 });

    const inventario = await getInventario(jogador.id);

    expect(inventario).toHaveLength(1);
    expect(inventario[0].item.id).toBe(BADGE);
    await conferirFecho(jogador);
  });
});
