// A loja contra o banco de verdade. O que não tem como ser testado fora dele é
// exatamente o que quebra dinheiro:
//
// 1. o `onConflictDoNothing` sobre o índice PARCIAL de `zenha_inventario` — o
//    predicado tem que ser inferido, senão o Postgres recusa o comando inteiro;
// 2. a escada do multiplicador contada por `date_trunc('month', now())`, que é
//    o relógio do BANCO e não o do runner;
// 3. o `onConflictDoUpdate` na PK `(player_id, slot)`, que é o "um por slot", e
//    a PK `(player_id, posicao)` da vitrine, que é o teto das cinco vagas;
// 4. o fecho `saldo == sum(zenha_ledger.amount)`, cobrado ao fim de TODO
//    cenário. É o preço de o saldo ser materializado, e no minuto em que os dois
//    divergem o extrato deixa de explicar o saldo.

import { describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  lojaItens,
  zenhaCarteiras,
  zenhaConfig,
  zenhaEquipados,
  zenhaInventario,
  zenhaLedger,
  zenhaVitrine,
  type Player,
} from "@/db/schema";
import {
  comprar,
  desequipar,
  destacar,
  equipar,
  getInventario,
  getVitrine,
  lerDestaques,
  lerVitrine,
  porNaVitrine,
  tirarDaVitrine,
} from "@/lib/loja";
import { VAGAS_NA_VITRINE } from "@/lib/item-da-loja";
import { precoDoMultiplicador } from "@/lib/zenha";
import {
  criarBadge,
  criarCorDoNome,
  criarItemDaLoja,
  criarMoldura,
  criarTitulo,
  garantirMultiplicador,
  jogadorComSaldo,
} from "@/test/fixtures-loja";

const BASE_DO_MULTIPLICADOR = 120;

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

async function vitrineDe(jogador: Player) {
  return db
    .select()
    .from(zenhaVitrine)
    .where(eq(zenhaVitrine.playerId, jogador.id))
    .orderBy(zenhaVitrine.posicao);
}

/** Retirar de venda é o gesto do admin; aqui ele é uma escrita direta. */
async function tirarDeVenda(itemId: number): Promise<void> {
  await db.update(lojaItens).set({ ativo: false }).where(eq(lojaItens.id, itemId));
}

describe("comprar", () => {
  it("debita o preço e entrega o item", async () => {
    const jogador = await jogadorComSaldo(1000);
    const badge = await criarBadge("Dono da bola", 250);

    expect(await comprar(jogador.id, badge.id)).toBeNull();

    const inventario = await linhasDoInventario(jogador);
    expect(inventario).toHaveLength(1);
    expect(inventario[0].itemId).toBe(badge.id);
    // O preço fica CONGELADO na linha: o admin mexe amanhã e o que ela pagou
    // continua sendo o que ela pagou.
    expect(inventario[0].precoPago).toBe(250);
    expect(inventario[0].consumivel).toBe(false);
    expect(inventario[0].fatorPercent).toBeNull();

    const [compra] = await comprasNoLedger(jogador);
    expect(compra.amount).toBe(-250);
    // A chave usa o id da linha do INVENTÁRIO, nunca o do item.
    expect(compra.dedupeKey).toBe(`compra:${inventario[0].id}`);
    expect(compra.inventarioId).toBe(inventario[0].id);

    expect(await conferirFecho(jogador)).toBe(750);
  });

  // Sem saldo NADA acontece: o insert do inventário já rodou quando o débito
  // recusa, e é o rollback da transação que o desfaz. Sem ele o item sairia de
  // graça — o defeito mais caro que uma loja pode ter.
  it("sem saldo, não debita e NÃO entrega", async () => {
    const jogador = await jogadorComSaldo(10);
    const badge = await criarBadge("Dono da bola", 250);

    expect(await comprar(jogador.id, badge.id)).toBe("sem-saldo");

    expect(await linhasDoInventario(jogador)).toHaveLength(0);
    expect(await comprasNoLedger(jogador)).toHaveLength(0);
    expect(await vitrineDe(jogador)).toHaveLength(0);
    expect(await conferirFecho(jogador)).toBe(10);
  });

  // O corte é ANTES do débito, e é ele que impede o segundo clique de cobrar por
  // um item que a pessoa já tem.
  it("o mesmo cosmético duas vezes cobra UMA vez", async () => {
    const jogador = await jogadorComSaldo(1000);
    const badge = await criarBadge("Dono da bola", 250);
    expect(await comprar(jogador.id, badge.id)).toBeNull();

    expect(await comprar(jogador.id, badge.id)).toBe("ja-possui");

    expect(await linhasDoInventario(jogador)).toHaveLength(1);
    expect(await comprasNoLedger(jogador)).toHaveLength(1);
    expect(await conferirFecho(jogador)).toBe(750);
  });

  it("item fora de venda é recusado, e nada é cobrado", async () => {
    const jogador = await jogadorComSaldo(1000);
    const retirado = await criarItemDaLoja({ tipo: "badge", nome: "Saiu", preco: 10, ativo: false });

    expect(await comprar(jogador.id, retirado.id)).toBe("item-indisponivel");

    expect(await linhasDoInventario(jogador)).toHaveLength(0);
    expect(await conferirFecho(jogador)).toBe(1000);
  });

  // Id que não existe dá a MESMA resposta de item fora de venda: distinguir os
  // dois faria a URL virar um oráculo de quais ids existem.
  it("item inexistente é recusado como indisponível", async () => {
    const jogador = await jogadorComSaldo(1000);

    expect(await comprar(jogador.id, 999_999)).toBe("item-indisponivel");

    expect(await conferirFecho(jogador)).toBe(1000);
  });

  // A escada existe porque o consumível é o único item recomprável: sem ela,
  // quem tem saldo compraria um por semana e ele deixaria de ser uma aposta.
  it("o multiplicador duas vezes cobra as DUAS, e a segunda mais cara", async () => {
    const jogador = await jogadorComSaldo(1000);
    const multiplicador = await garantirMultiplicador(BASE_DO_MULTIPLICADOR);
    const primeiro = precoDoMultiplicador(BASE_DO_MULTIPLICADOR, 0);
    const segundo = precoDoMultiplicador(BASE_DO_MULTIPLICADOR, 1);
    expect(segundo).toBeGreaterThan(primeiro);

    expect(await comprar(jogador.id, multiplicador.id)).toBeNull();
    expect(await comprar(jogador.id, multiplicador.id)).toBeNull();

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
    const jogador = await jogadorComSaldo(1000);
    const multiplicador = await garantirMultiplicador(BASE_DO_MULTIPLICADOR);
    await comprar(jogador.id, multiplicador.id);

    const vitrine = await getVitrine(jogador.id);
    const naVitrine = vitrine.itens.find((i) => i.item.id === multiplicador.id);

    expect(vitrine.multiplicadoresNoMes).toBe(1);
    expect(naVitrine?.preco).toBe(precoDoMultiplicador(BASE_DO_MULTIPLICADOR, 1));
    await conferirFecho(jogador);
  });

  // O preço-base do consumível deixou de ser ajuste da economia e virou a coluna
  // `preco` da linha dele: a escada agora sobe a partir do que o admin cadastrou.
  it("a escada sobe a partir do preço cadastrado na linha do item", async () => {
    const jogador = await jogadorComSaldo(2000);
    const multiplicador = await garantirMultiplicador(200);

    await comprar(jogador.id, multiplicador.id);
    await comprar(jogador.id, multiplicador.id);

    const inventario = await linhasDoInventario(jogador);
    expect(inventario.map((i) => i.precoPago)).toEqual([
      precoDoMultiplicador(200, 0),
      precoDoMultiplicador(200, 1),
    ]);
    await conferirFecho(jogador);
  });

  it("o multiplicador congela o fator vigente, e mudar o ajuste depois não o altera", async () => {
    const jogador = await jogadorComSaldo(1000);
    const multiplicador = await garantirMultiplicador();
    await db.insert(zenhaConfig).values({ chave: "multiplicador_fator", valor: 200 });

    expect(await comprar(jogador.id, multiplicador.id)).toBeNull();

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

  // O preço mínimo do item é 0 no painel do admin, e o ledger tem
  // `check (amount <> 0)`: mandar isso ao débito derrubaria a compra inteira.
  // Item de graça entra sem linha no extrato, e o fecho continua de pé.
  it("preço zerado entrega o item sem linha no extrato", async () => {
    const jogador = await jogadorComSaldo(100);
    const gratis = await criarMoldura("Moldura de graça", 0);

    expect(await comprar(jogador.id, gratis.id)).toBeNull();

    expect(await linhasDoInventario(jogador)).toHaveLength(1);
    expect(await comprasNoLedger(jogador)).toHaveLength(0);
    expect(await conferirFecho(jogador)).toBe(100);
  });

  // Duas compras do mesmo cosmético ao mesmo tempo: uma entrega, a outra bate na
  // unique parcial e volta com "ja-possui" — sem cobrar duas vezes.
  it("duas compras concorrentes do mesmo cosmético cobram uma só", async () => {
    const jogador = await jogadorComSaldo(1000);
    const badge = await criarBadge("Dono da bola", 250);

    const resultados = await Promise.all([
      comprar(jogador.id, badge.id),
      comprar(jogador.id, badge.id),
    ]);

    expect(resultados.filter((r) => r === null)).toHaveLength(1);
    expect(await linhasDoInventario(jogador)).toHaveLength(1);
    expect(await comprasNoLedger(jogador)).toHaveLength(1);
    expect(await conferirFecho(jogador)).toBe(750);
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
    const jogador = await jogadorComSaldo(1000);
    const multiplicador = await garantirMultiplicador(BASE_DO_MULTIPLICADOR);
    const primeiro = precoDoMultiplicador(BASE_DO_MULTIPLICADOR, 0);
    const segundo = precoDoMultiplicador(BASE_DO_MULTIPLICADOR, 1);

    const resultados = await Promise.all([
      comprar(jogador.id, multiplicador.id),
      comprar(jogador.id, multiplicador.id),
    ]);

    // As duas passam — recomprar é o comportamento esperado. O que não pode é
    // as duas saírem pelo mesmo preço.
    expect(resultados).toEqual([null, null]);
    const inventario = await linhasDoInventario(jogador);
    expect(inventario.map((i) => i.precoPago).sort((a, b) => a - b)).toEqual([primeiro, segundo]);
    expect(await conferirFecho(jogador)).toBe(1000 - primeiro - segundo);
  });
});

// Comprar COLOCA o item. É a resposta à pergunta que toda loja de cosmético
// gera ("comprei, e agora?") — e ela nunca pode derrubar a compra.
describe("comprar já coloca o item", () => {
  it("o primeiro badge vai para a vaga 1 e vira o destaque", async () => {
    const jogador = await jogadorComSaldo(1000);
    const badge = await criarBadge("Dono da bola", 250);

    await comprar(jogador.id, badge.id);

    const vitrine = await vitrineDe(jogador);
    expect(vitrine).toHaveLength(1);
    expect(vitrine[0].posicao).toBe(1);
    expect(vitrine[0].destaque).toBe(true);
    await conferirFecho(jogador);
  });

  it("o segundo badge vai para a vaga 2 e NÃO rouba o destaque", async () => {
    const jogador = await jogadorComSaldo(1000);
    const primeiro = await criarBadge("Primeiro", 10);
    const segundo = await criarBadge("Segundo", 10);

    await comprar(jogador.id, primeiro.id);
    await comprar(jogador.id, segundo.id);

    const vitrine = await vitrineDe(jogador);
    expect(vitrine.map((v) => v.posicao)).toEqual([1, 2]);
    expect(vitrine.map((v) => v.destaque)).toEqual([true, false]);
    await conferirFecho(jogador);
  });

  it("com a vitrine cheia, o sexto badge é comprado e fica só no inventário", async () => {
    const jogador = await jogadorComSaldo(1000);
    const badges = [];
    for (let i = 0; i < VAGAS_NA_VITRINE + 1; i += 1) {
      badges.push(await criarBadge(`Badge ${i}`, 10));
    }

    for (const badge of badges) expect(await comprar(jogador.id, badge.id)).toBeNull();

    // A compra ACONTECEU — vitrine cheia não recusa dinheiro.
    expect(await linhasDoInventario(jogador)).toHaveLength(VAGAS_NA_VITRINE + 1);
    expect(await vitrineDe(jogador)).toHaveLength(VAGAS_NA_VITRINE);
    expect(await conferirFecho(jogador)).toBe(1000 - 10 * (VAGAS_NA_VITRINE + 1));
  });

  it("cosmético de slot único é equipado quando o slot está vazio", async () => {
    const jogador = await jogadorComSaldo(1000);
    const moldura = await criarMoldura("Moldura de ouro", 100);

    await comprar(jogador.id, moldura.id);

    const equipados = await db
      .select()
      .from(zenhaEquipados)
      .where(eq(zenhaEquipados.playerId, jogador.id));
    expect(equipados).toHaveLength(1);
    expect(equipados[0].slot).toBe("moldura");
    await conferirFecho(jogador);
  });

  // Comprar não pode DESEQUIPAR o que a pessoa escolheu: quem chegou primeiro
  // fica, e trocar é no inventário.
  it("a segunda moldura não desaloja a que já estava equipada", async () => {
    const jogador = await jogadorComSaldo(1000);
    const primeira = await criarMoldura("Primeira", 10);
    const segunda = await criarMoldura("Segunda", 10);

    await comprar(jogador.id, primeira.id);
    await comprar(jogador.id, segunda.id);

    const [equipado] = await db
      .select()
      .from(zenhaEquipados)
      .where(eq(zenhaEquipados.playerId, jogador.id));
    const inventario = await linhasDoInventario(jogador);
    expect(equipado.inventarioId).toBe(inventario[0].id);
    await conferirFecho(jogador);
  });

  it("o consumível não vai para lugar nenhum — ele se arma num fut", async () => {
    const jogador = await jogadorComSaldo(1000);
    const multiplicador = await garantirMultiplicador();

    await comprar(jogador.id, multiplicador.id);

    expect(await vitrineDe(jogador)).toHaveLength(0);
    expect(await db.select().from(zenhaEquipados)).toHaveLength(0);
    await conferirFecho(jogador);
  });
});

describe("a vitrine de badges", () => {
  async function comBadge(jogador: Player, nome: string, preco = 10) {
    const badge = await criarBadge(nome, preco);
    await comprar(jogador.id, badge.id);
    const inventario = await linhasDoInventario(jogador);
    return { badge, inventarioId: inventario[inventario.length - 1].id };
  }

  it("tirar libera a vaga, e o item continua no inventário", async () => {
    const jogador = await jogadorComSaldo(1000);
    const { inventarioId } = await comBadge(jogador, "Único");

    await tirarDaVitrine(jogador.id, inventarioId);

    expect(await vitrineDe(jogador)).toHaveLength(0);
    expect(await linhasDoInventario(jogador)).toHaveLength(1);
    await conferirFecho(jogador);
  });

  it("pôr de volta reaproveita a vaga mais baixa que estiver livre", async () => {
    const jogador = await jogadorComSaldo(1000);
    const primeiro = await comBadge(jogador, "Um");
    await comBadge(jogador, "Dois");
    await tirarDaVitrine(jogador.id, primeiro.inventarioId);

    expect(await porNaVitrine(jogador.id, primeiro.inventarioId)).toBeNull();

    const vitrine = await vitrineDe(jogador);
    expect(vitrine.find((v) => v.inventarioId === primeiro.inventarioId)?.posicao).toBe(1);
    await conferirFecho(jogador);
  });

  it("pôr o que já está na vitrine é no-op, não erro", async () => {
    const jogador = await jogadorComSaldo(1000);
    const { inventarioId } = await comBadge(jogador, "Único");

    expect(await porNaVitrine(jogador.id, inventarioId)).toBeNull();

    expect(await vitrineDe(jogador)).toHaveLength(1);
  });

  it("a sexta vaga não existe: o pedido volta como vitrine-cheia", async () => {
    const jogador = await jogadorComSaldo(1000);
    for (let i = 0; i < VAGAS_NA_VITRINE; i += 1) await comBadge(jogador, `Badge ${i}`);
    const sexto = await comBadge(jogador, "Sexto");
    // Ele foi comprado com a vitrine já cheia, então nem entrou.
    expect(await vitrineDe(jogador)).toHaveLength(VAGAS_NA_VITRINE);

    expect(await porNaVitrine(jogador.id, sexto.inventarioId)).toBe("vitrine-cheia");

    expect(await vitrineDe(jogador)).toHaveLength(VAGAS_NA_VITRINE);
    await conferirFecho(jogador);
  });

  it("badge de outra pessoa não entra na minha vitrine", async () => {
    const dono = await jogadorComSaldo(1000);
    const intruso = await jogadorComSaldo(1000);
    const { inventarioId } = await comBadge(dono, "Do dono");

    expect(await porNaVitrine(intruso.id, inventarioId)).toBe("item-nao-e-seu");

    expect(await vitrineDe(intruso)).toHaveLength(0);
  });

  // Tirar não tem caminho de erro e destacar tem uma resposta só, então a prova
  // dos dois é a mesma: a linha do dono continua onde estava, do jeito que estava.
  it("tirar da vitrine e destacar não alcançam o badge de outra pessoa", async () => {
    const dono = await jogadorComSaldo(1000);
    const intruso = await jogadorComSaldo(1000);
    const { inventarioId } = await comBadge(dono, "Do dono");

    await tirarDaVitrine(intruso.id, inventarioId);
    expect(await destacar(intruso.id, inventarioId)).toBe("item-nao-e-seu");

    const vitrine = await vitrineDe(dono);
    expect(vitrine).toHaveLength(1);
    expect(vitrine[0].inventarioId).toBe(inventarioId);
    expect(vitrine[0].destaque).toBe(true);
    expect(await vitrineDe(intruso)).toHaveLength(0);
  });

  it("só badge entra na vitrine — moldura, título e consumível não", async () => {
    const jogador = await jogadorComSaldo(2000);
    const multiplicador = await garantirMultiplicador();
    for (const item of [
      await criarMoldura("M", 10),
      await criarTitulo("T", 10),
      await criarCorDoNome("C", 10),
      multiplicador,
    ]) {
      await comprar(jogador.id, item.id);
    }

    const inventario = await linhasDoInventario(jogador);
    for (const linha of inventario) {
      expect(await porNaVitrine(jogador.id, linha.id)).toBe("item-nao-e-seu");
    }
    expect(await vitrineDe(jogador)).toHaveLength(0);
  });

  it("destacar troca o destaque, e continua havendo só um", async () => {
    const jogador = await jogadorComSaldo(1000);
    const primeiro = await comBadge(jogador, "Um");
    const segundo = await comBadge(jogador, "Dois");
    expect((await vitrineDe(jogador)).find((v) => v.destaque)?.inventarioId).toBe(
      primeiro.inventarioId,
    );

    expect(await destacar(jogador.id, segundo.inventarioId)).toBeNull();

    const vitrine = await vitrineDe(jogador);
    expect(vitrine.filter((v) => v.destaque)).toHaveLength(1);
    expect(vitrine.find((v) => v.destaque)?.inventarioId).toBe(segundo.inventarioId);
  });

  it("destacar o que não está na vitrine é recusado", async () => {
    const jogador = await jogadorComSaldo(1000);
    const { inventarioId } = await comBadge(jogador, "Único");
    await tirarDaVitrine(jogador.id, inventarioId);

    expect(await destacar(jogador.id, inventarioId)).toBe("item-nao-e-seu");

    expect(await vitrineDe(jogador)).toHaveLength(0);
  });

  // Tirar o destaque não promove ninguém: ficar sem badge ao lado do nome é um
  // estado legítimo, e escolher um substituto seria decidir por quem decidiu.
  it("tirar o destaque deixa a vitrine sem destaque nenhum", async () => {
    const jogador = await jogadorComSaldo(1000);
    const primeiro = await comBadge(jogador, "Um");
    await comBadge(jogador, "Dois");

    await tirarDaVitrine(jogador.id, primeiro.inventarioId);

    expect((await vitrineDe(jogador)).filter((v) => v.destaque)).toHaveLength(0);
  });

  it("lerVitrine devolve na ordem das vagas, com o item resolvido", async () => {
    const jogador = await jogadorComSaldo(1000);
    const um = await comBadge(jogador, "Primeiro");
    const dois = await comBadge(jogador, "Segundo");
    await destacar(jogador.id, dois.inventarioId);

    const vitrine = await lerVitrine(db, jogador.id);

    expect(vitrine.map((b) => b.item.nome)).toEqual(["Primeiro", "Segundo"]);
    expect(vitrine.map((b) => b.posicao)).toEqual([1, 2]);
    expect(vitrine.map((b) => b.destaque)).toEqual([false, true]);
    expect(vitrine[0].item.imagemHash).toEqual(um.badge.imagemHash);
  });
});

describe("lerDestaques", () => {
  it("traz um por jogador, em lote, e omite quem não tem", async () => {
    const comDestaque = await jogadorComSaldo(1000);
    const semVitrine = await jogadorComSaldo(1000);
    const semNada = await jogadorComSaldo(0);
    const badge = await criarBadge("Avaí", 10);
    const outro = await criarBadge("Figueirense", 10);
    await comprar(comDestaque.id, badge.id);
    await comprar(semVitrine.id, outro.id);
    const [linha] = await linhasDoInventario(semVitrine);
    await tirarDaVitrine(semVitrine.id, linha.id);

    const destaques = await lerDestaques(db, [comDestaque.id, semVitrine.id, semNada.id]);

    expect(destaques.size).toBe(1);
    expect(destaques.get(comDestaque.id)).toEqual({
      itemId: badge.id,
      nome: "Avaí",
      imagemHash: badge.imagemHash,
    });
  });

  it("lista vazia devolve mapa vazio sem ir ao banco", async () => {
    expect(await lerDestaques(db, [])).toEqual(new Map());
  });

  // Item retirado de venda continua no perfil de quem comprou — é a
  // contrapartida de o admin poder tirá-lo da vitrine sem apagar nada.
  it("badge fora de venda continua em destaque", async () => {
    const jogador = await jogadorComSaldo(1000);
    const badge = await criarBadge("Raro", 10);
    await comprar(jogador.id, badge.id);
    await tirarDeVenda(badge.id);

    const destaques = await lerDestaques(db, [jogador.id]);

    expect(destaques.get(jogador.id)?.nome).toBe("Raro");
  });
});

describe("equipar", () => {
  it("troca o item do slot sem deixar dois", async () => {
    const jogador = await jogadorComSaldo(2000);
    const primeira = await criarMoldura("Primeira", 10);
    const segunda = await criarMoldura("Segunda", 10);
    await comprar(jogador.id, primeira.id);
    await comprar(jogador.id, segunda.id);
    const [umaLinha, outraLinha] = await linhasDoInventario(jogador);

    expect(await equipar(jogador.id, umaLinha.id)).toBeNull();
    expect(await equipar(jogador.id, outraLinha.id)).toBeNull();

    const equipados = await db
      .select()
      .from(zenhaEquipados)
      .where(eq(zenhaEquipados.playerId, jogador.id));
    expect(equipados).toHaveLength(1);
    expect(equipados[0].slot).toBe("moldura");
    expect(equipados[0].inventarioId).toBe(outraLinha.id);
    await conferirFecho(jogador);
  });

  it("slots diferentes convivem", async () => {
    const jogador = await jogadorComSaldo(2000);
    const moldura = await criarMoldura("M", 10);
    const titulo = await criarTitulo("T", 10);
    await comprar(jogador.id, moldura.id);
    await comprar(jogador.id, titulo.id);

    const inventario = await getInventario(jogador.id);
    const porItem = new Map(inventario.map((i) => [i.item.id, i.equipadoEm]));
    expect(porItem.get(moldura.id)).toBe("moldura");
    expect(porItem.get(titulo.id)).toBe("titulo");
    await conferirFecho(jogador);
  });

  // O `player_id` está no WHERE da leitura: id de outra pessoa não vira
  // cosmético no perfil de quem mandou o POST.
  it("item de outra pessoa não faz nada", async () => {
    const dono = await jogadorComSaldo(1000);
    const intruso = await jogadorComSaldo(1000);
    const moldura = await criarMoldura("M", 10);
    await comprar(dono.id, moldura.id);
    const [doDono] = await linhasDoInventario(dono);

    expect(await equipar(intruso.id, doDono.id)).toBe("item-nao-e-seu");

    const equipados = await db
      .select()
      .from(zenhaEquipados)
      .where(eq(zenhaEquipados.playerId, intruso.id));
    expect(equipados).toHaveLength(0);
    await conferirFecho(dono);
    await conferirFecho(intruso);
  });

  // Nem o consumível (que se arma num fut) nem o badge (que vai para a vitrine)
  // têm slot. Os dois dão a mesma resposta opaca.
  it("multiplicador e badge não equipam", async () => {
    const jogador = await jogadorComSaldo(1000);
    const multiplicador = await garantirMultiplicador();
    const badge = await criarBadge("B", 10);
    await comprar(jogador.id, multiplicador.id);
    await comprar(jogador.id, badge.id);

    for (const linha of await linhasDoInventario(jogador)) {
      expect(await equipar(jogador.id, linha.id)).toBe("item-nao-e-seu");
    }

    expect(await db.select().from(zenhaEquipados)).toHaveLength(0);
    await conferirFecho(jogador);
  });

  it("desequipar esvazia só o slot pedido, e repetir não estoura", async () => {
    const jogador = await jogadorComSaldo(2000);
    const moldura = await criarMoldura("M", 10);
    const titulo = await criarTitulo("T", 10);
    await comprar(jogador.id, moldura.id);
    await comprar(jogador.id, titulo.id);

    await desequipar(jogador.id, "moldura");
    await desequipar(jogador.id, "moldura");

    const equipados = await db
      .select()
      .from(zenhaEquipados)
      .where(eq(zenhaEquipados.playerId, jogador.id));
    expect(equipados).toHaveLength(1);
    expect(equipados[0].slot).toBe("titulo");
    await conferirFecho(jogador);
  });

  it("desequipar não alcança o slot de outra pessoa", async () => {
    const dono = await jogadorComSaldo(1000);
    const intruso = await jogadorComSaldo(1000);
    const moldura = await criarMoldura("M", 10);
    await comprar(dono.id, moldura.id);

    await desequipar(intruso.id, "moldura");

    expect(await db.select().from(zenhaEquipados)).toHaveLength(1);
    await conferirFecho(dono);
  });
});

describe("getVitrine e getInventario", () => {
  it("a vitrine marca o que já é dele e traz o saldo", async () => {
    const jogador = await jogadorComSaldo(1000);
    const multiplicador = await garantirMultiplicador();
    const comprado = await criarBadge("Comprado", 250);
    const naoComprado = await criarBadge("Não comprado", 250);
    await comprar(jogador.id, comprado.id);

    const vitrine = await getVitrine(jogador.id);

    expect(vitrine.saldo).toBe(750);
    expect(vitrine.itens.find((i) => i.item.id === comprado.id)?.possui).toBe(true);
    expect(vitrine.itens.find((i) => i.item.id === naoComprado.id)?.possui).toBe(false);
    // O consumível NUNCA aparece como possuído: ele é recomprável.
    expect(vitrine.itens.find((i) => i.item.id === multiplicador.id)?.possui).toBe(false);
    await conferirFecho(jogador);
  });

  it("a vitrine não mostra o que saiu de venda", async () => {
    const jogador = await jogadorComSaldo(1000);
    const aVenda = await criarBadge("À venda", 10);
    const fora = await criarItemDaLoja({ tipo: "badge", nome: "Fora", preco: 10, ativo: false });

    const vitrine = await getVitrine(jogador.id);

    expect(vitrine.itens.map((i) => i.item.id)).toContain(aVenda.id);
    expect(vitrine.itens.map((i) => i.item.id)).not.toContain(fora.id);
  });

  it("o inventário de quem nunca comprou é vazio", async () => {
    const jogador = await jogadorComSaldo(1000);

    expect(await getInventario(jogador.id)).toEqual([]);
    await conferirFecho(jogador);
  });

  it("o inventário não mistura o de dois jogadores", async () => {
    const a = await jogadorComSaldo(1000);
    const b = await jogadorComSaldo(1000);
    const doA = await criarBadge("Do A", 10);
    const doB = await criarMoldura("Do B", 10);
    await comprar(a.id, doA.id);
    await comprar(b.id, doB.id);

    const inventario = await getInventario(a.id);

    expect(inventario).toHaveLength(1);
    expect(inventario[0].item.id).toBe(doA.id);
    await conferirFecho(a);
    await conferirFecho(b);
  });

  it("o inventário diz onde o badge está na vitrine", async () => {
    const jogador = await jogadorComSaldo(1000);
    const badge = await criarBadge("Único", 10);
    await comprar(jogador.id, badge.id);

    const [item] = await getInventario(jogador.id);

    expect(item.naVitrine).toEqual({ posicao: 1, destaque: true });
    expect(item.equipadoEm).toBeNull();
    await conferirFecho(jogador);
  });

  it("o inventário mostra o item que saiu de venda — ele continua sendo dele", async () => {
    const jogador = await jogadorComSaldo(1000);
    const badge = await criarBadge("Raro", 10);
    await comprar(jogador.id, badge.id);
    await tirarDeVenda(badge.id);

    const inventario = await getInventario(jogador.id);

    expect(inventario).toHaveLength(1);
    expect(inventario[0].item.ativo).toBe(false);
    await conferirFecho(jogador);
  });
});
