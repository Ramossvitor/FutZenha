import { beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  games,
  matchDays,
  skillHistory,
  zenhaInventario,
  zenhaMultiplicadores,
  type MatchDay,
  type Player,
} from "@/db/schema";
import { criarFut, criarJogadorComConta } from "@/test/fixtures";
import {
  armar,
  congelarMultiplicadores,
  desarmar,
  devolverMultiplicadoresSemNota,
  lerMultiplicadoresPorRodada,
  situacaoDoMultiplicador,
  soltarArmesDeFutsAbandonados,
} from "./multiplicador-engine";
import { ID_DO_MULTIPLICADOR } from "./loja-catalogo";
import { AJUSTES } from "./zenha";

// O ciclo do multiplicador contra o banco de verdade.
//
// O que estes testes existem para provar é UMA coisa: que não dá para armar
// sabendo como você jogou. O fut é encerrado horas depois de acabar, então o
// corte não pode ser "antes do encerramento" — tem que ser antes de a bola
// rolar, e tem que valer também no DESARME. Um antiabuso que só guarda uma das
// pontas não guarda nada.

const FATOR = AJUSTES.multiplicador_fator.padrao;

/** Um fut marcado para daqui a alguns dias, às 20h. */
async function futFuturo(extra: Partial<typeof matchDays.$inferInsert> = {}): Promise<MatchDay> {
  return criarFut({
    // A data vem do relógio do BANCO, nunca de `new Date()` — o driver rejeita
    // Date em template sql cru, e a suíte não pode depender do fuso da máquina.
    date: sql`((now() at time zone 'America/Sao_Paulo')::date + 3)` as unknown as string,
    startTime: "20:00",
    ...extra,
  });
}

/** Um fut cujo horário de início já passou. */
async function futJaComecado(
  extra: Partial<typeof matchDays.$inferInsert> = {},
): Promise<MatchDay> {
  return criarFut({
    date: sql`((now() at time zone 'America/Sao_Paulo')::date - 1)` as unknown as string,
    startTime: "20:00",
    ...extra,
  });
}

/** Põe um multiplicador comprado no inventário de alguém. */
async function comprarMultiplicador(jogador: Player): Promise<number> {
  const [item] = await db
    .insert(zenhaInventario)
    .values({
      playerId: jogador.id,
      itemId: ID_DO_MULTIPLICADOR,
      precoPago: 120,
      consumivel: true,
      fatorPercent: FATOR,
    })
    .returning({ id: zenhaInventario.id });
  return item.id;
}

const armeDe = async (inventarioId: number) => {
  const [linha] = await db
    .select({
      matchDayId: zenhaInventario.armadoMatchDayId,
      armadoEm: zenhaInventario.armadoEm,
      cortePrevisto: zenhaInventario.cortePrevisto,
    })
    .from(zenhaInventario)
    .where(eq(zenhaInventario.id, inventarioId));
  return linha;
};

/** O carimbo de "gasto". Nulo = o item está inteiro no inventário. */
const consumidoEmDe = async (inventarioId: number) => {
  const [linha] = await db
    .select({ consumidoEm: zenhaInventario.consumidoEm })
    .from(zenhaInventario)
    .where(eq(zenhaInventario.id, inventarioId));
  return linha.consumidoEm;
};

let jogador: Player;
let inventarioId: number;

beforeEach(async () => {
  const { jogador: j } = await criarJogadorComConta();
  jogador = j;
  inventarioId = await comprarMultiplicador(jogador);
});

describe("armar", () => {
  it("arma num fut que ainda não começou e congela o corte", async () => {
    const fut = await futFuturo();
    expect(await armar(db, jogador.id, fut.id, inventarioId)).toBeNull();

    const arme = await armeDe(inventarioId);
    expect(arme.matchDayId).toBe(fut.id);
    expect(arme.armadoEm).not.toBeNull();
    // O corte é o horário de início do fut, resolvido pelo Postgres — é ele que
    // sobrevive a uma mudança de data depois.
    expect(arme.cortePrevisto).not.toBeNull();
    expect(arme.armadoEm!.getTime()).toBeLessThan(arme.cortePrevisto!.getTime());
  });

  // O caso que o antiabuso existe para fechar: o fut aconteceu, o admin ainda
  // não encerrou, e a pessoa já sabe como jogou.
  it("recusa depois de a bola rolar, mesmo com o fut ainda aberto", async () => {
    const fut = await futJaComecado();
    expect(await armar(db, jogador.id, fut.id, inventarioId)).toBe("multiplicador-indisponivel");
    expect((await armeDe(inventarioId)).matchDayId).toBeNull();
  });

  // Fut sem horário marcado vale meia-noite do dia: conservador de propósito,
  // porque sem horário o dia inteiro já é "depois da bola rolar".
  it("fut sem horário de início fecha à meia-noite do dia", async () => {
    const hoje = await criarFut({
      date: sql`((now() at time zone 'America/Sao_Paulo')::date)` as unknown as string,
      startTime: null,
    });
    expect(await armar(db, jogador.id, hoje.id, inventarioId)).toBe("multiplicador-indisponivel");

    const amanha = await criarFut({
      date: sql`((now() at time zone 'America/Sao_Paulo')::date + 1)` as unknown as string,
      startTime: null,
    });
    expect(await armar(db, jogador.id, amanha.id, inventarioId)).toBeNull();
  });

  it("recusa fut já encerrado", async () => {
    const fut = await futFuturo({ status: "finished" });
    expect(await armar(db, jogador.id, fut.id, inventarioId)).toBe("multiplicador-indisponivel");
  });

  it("recusa item de outra pessoa", async () => {
    const fut = await futFuturo();
    const { jogador: outro } = await criarJogadorComConta();
    expect(await armar(db, outro.id, fut.id, inventarioId)).toBe("multiplicador-indisponivel");
    expect((await armeDe(inventarioId)).matchDayId).toBeNull();
  });

  it("recusa armar o mesmo item duas vezes", async () => {
    const fut = await futFuturo();
    const outroFut = await futFuturo();
    expect(await armar(db, jogador.id, fut.id, inventarioId)).toBeNull();
    expect(await armar(db, jogador.id, outroFut.id, inventarioId)).toBe(
      "multiplicador-indisponivel",
    );
    expect((await armeDe(inventarioId)).matchDayId).toBe(fut.id);
  });

  // A testemunha independente fecha a janela ANTES do horário marcado quando o
  // fut começa adiantado. A súmula ao vivo abre em `teams_drawn` e não confere
  // relógio, então um jogo pode nascer no dia do fut antes do kickoff — e a
  // liquidação trata isso como "a bola já rolou".
  //
  // Sem esta guarda no `armar`, o app ACEITARIA o arme às 19h45 e a liquidação o
  // anularia depois como `corte-antecipado`, culpando uma antecipação de horário
  // que nunca houve. A oferta tem que seguir a testemunha, nunca o contrário.
  it("recusa depois de o primeiro jogo do dia ser lançado, mesmo antes do horário", async () => {
    const { criarJogo } = await import("@/test/fixtures-avaliacao");
    const { jogador: adversario } = await criarJogadorComConta();
    // Hoje às 23h59: o relógio ainda não chegou lá, então só a testemunha pode
    // fechar a janela.
    const hoje = await criarFut({
      date: sql`((now() at time zone 'America/Sao_Paulo')::date)` as unknown as string,
      startTime: "23:59",
    });
    expect(await situacaoDoMultiplicador(db, jogador.id, hoje.id)).toMatchObject({ aceita: true });

    await criarJogo(hoje, [jogador], [adversario]);

    expect(await armar(db, jogador.id, hoje.id, inventarioId)).toBe("multiplicador-indisponivel");
    // E a tela deixa de oferecer no MESMO instante: é o mesmo predicado.
    expect(await situacaoDoMultiplicador(db, jogador.id, hoje.id)).toMatchObject({ aceita: false });
  });

  // Jogo lançado em dias anteriores não é sinal de nada — é o mesmo `greatest`
  // com a meia-noite que protege `PRIMEIRO_SINAL_DE_BOLA` de ser envenenado.
  it("jogo lançado num dia anterior não fecha a janela", async () => {
    const { criarJogo } = await import("@/test/fixtures-avaliacao");
    const { jogador: adversario } = await criarJogadorComConta();
    const fut = await futFuturo();
    const jogo = await criarJogo(fut, [jogador], [adversario]);
    await db
      .update(games)
      .set({ createdAt: sql`now() - interval '2 days'` })
      .where(eq(games.id, jogo.id));

    expect(await armar(db, jogador.id, fut.id, inventarioId)).toBeNull();
  });

  // Não existe empilhar dois multiplicadores no mesmo fut para dobrar o efeito.
  //
  // A unique parcial do schema é a garantia final, mas a recusa tem que sair
  // pelo `WHERE` — como RESPOSTA, e não como exceção. `armar` é chamada por uma
  // Server Action, que é endpoint público: quem forjar o POST com o id do
  // segundo item recebe o mesmo slug de sempre, não uma página de erro 500.
  it("recusa um segundo multiplicador no mesmo fut", async () => {
    const fut = await futFuturo();
    const segundo = await comprarMultiplicador(jogador);
    expect(await armar(db, jogador.id, fut.id, inventarioId)).toBeNull();
    expect(await armar(db, jogador.id, fut.id, segundo)).toBe("multiplicador-indisponivel");
    // E o segundo item continua livre, não meio-armado.
    expect((await armeDe(segundo)).matchDayId).toBeNull();
  });
});

describe("desarmar", () => {
  it("desarma antes da bola rolar e devolve o item", async () => {
    const fut = await futFuturo();
    await armar(db, jogador.id, fut.id, inventarioId);

    expect(await desarmar(db, jogador.id, inventarioId)).toBeNull();
    const arme = await armeDe(inventarioId);
    expect(arme.matchDayId).toBeNull();
    expect(arme.armadoEm).toBeNull();
    expect(arme.cortePrevisto).toBeNull();
  });

  // O buraco que a guarda no desarme fecha, e a razão de ela existir: armar na
  // véspera, jogar mal, e desarmar antes de o admin encerrar seria desfazer a
  // aposta já sabendo o resultado.
  it("RECUSA desarmar depois de a bola rolar", async () => {
    const fut = await futFuturo();
    await armar(db, jogador.id, fut.id, inventarioId);

    // O fut é antecipado para ontem: a bola já rolou.
    await db
      .update(matchDays)
      .set({ date: sql`((now() at time zone 'America/Sao_Paulo')::date - 1)` })
      .where(eq(matchDays.id, fut.id));

    expect(await desarmar(db, jogador.id, inventarioId)).toBe("multiplicador-travado");
    expect((await armeDe(inventarioId)).matchDayId).toBe(fut.id);
  });

  it("recusa desarmar item de outra pessoa", async () => {
    const fut = await futFuturo();
    await armar(db, jogador.id, fut.id, inventarioId);
    const { jogador: outro } = await criarJogadorComConta();
    expect(await desarmar(db, outro.id, inventarioId)).toBe("multiplicador-travado");
  });
});

describe("congelarMultiplicadores", () => {
  /** Escala o jogador num jogo do fut, que é o que prova que ele entrou em campo. */
  async function escalar(fut: MatchDay, quem: Player) {
    const { criarJogo } = await import("@/test/fixtures-avaliacao");
    const { jogador: adversario } = await criarJogadorComConta();
    await criarJogo(fut, [quem], [adversario]);
  }

  it("arme válido de quem jogou vira fato durável e consome o item", async () => {
    const fut = await futFuturo();
    await armar(db, jogador.id, fut.id, inventarioId);
    await escalar(fut, jogador);

    await db.transaction((tx) => congelarMultiplicadores(tx, fut.id, 42));

    const [fato] = await db
      .select()
      .from(zenhaMultiplicadores)
      .where(eq(zenhaMultiplicadores.matchDayId, fut.id));
    expect(fato.playerId).toBe(jogador.id);
    expect(fato.inventarioId).toBe(inventarioId);
    // O fator é congelado a partir do que estava no inventário, não do ajuste
    // vigente: se a loja mudar de força amanhã, esta rodada continua a mesma.
    expect(fato.fatorNum / fato.fatorDen).toBeCloseTo(FATOR / 100, 5);

    // O item saiu do inventário como armado — foi consumido.
    expect((await armeDe(inventarioId)).matchDayId).toBeNull();
  });

  it("quem armou e não entrou em campo tem o item de volta", async () => {
    const fut = await futFuturo();
    await armar(db, jogador.id, fut.id, inventarioId);

    await db.transaction((tx) => congelarMultiplicadores(tx, fut.id, 42));

    expect(await db.select().from(zenhaMultiplicadores)).toHaveLength(0);
    expect((await armeDe(inventarioId)).matchDayId).toBeNull();
  });

  it("fut encerrado sem rodada devolve o item", async () => {
    const fut = await futFuturo();
    await armar(db, jogador.id, fut.id, inventarioId);
    await escalar(fut, jogador);

    await db.transaction((tx) => congelarMultiplicadores(tx, fut.id, null));

    expect(await db.select().from(zenhaMultiplicadores)).toHaveLength(0);
  });

  // Adiar não abre janela: o corte congelado no arme continua valendo, e ele é
  // MENOR que o horário novo.
  it("adiar o fut mantém o arme válido", async () => {
    const fut = await futFuturo();
    await armar(db, jogador.id, fut.id, inventarioId);
    await escalar(fut, jogador);
    await db
      .update(matchDays)
      .set({ date: sql`((now() at time zone 'America/Sao_Paulo')::date + 30)` })
      .where(eq(matchDays.id, fut.id));

    await db.transaction((tx) => congelarMultiplicadores(tx, fut.id, 42));
    expect(await db.select().from(zenhaMultiplicadores)).toHaveLength(1);
  });

  // Antecipar para antes do arme invalida — e devolve, em vez de aceitar às
  // cegas um arme feito depois do novo horário.
  it("antecipar o fut para antes do arme devolve o item", async () => {
    const fut = await futFuturo();
    await armar(db, jogador.id, fut.id, inventarioId);
    await escalar(fut, jogador);
    await db
      .update(matchDays)
      .set({ date: sql`((now() at time zone 'America/Sao_Paulo')::date - 10)` })
      .where(eq(matchDays.id, fut.id));

    await db.transaction((tx) => congelarMultiplicadores(tx, fut.id, 42));
    expect(await db.select().from(zenhaMultiplicadores)).toHaveLength(0);
  });

  // O bug mais caro que este arquivo cobre: se o consumo apenas limpasse as
  // colunas do arme, o item voltaria à prateleira depois de gasto — e UMA
  // compra viraria multiplicador infinito, um por fut, para sempre. A linha não
  // pode ser apagada (o fato do replay aponta para ela com cascade), então o
  // que separa "usado" de "livre" é o carimbo `consumido_em`.
  it("o item consumido NÃO volta a ficar disponível", async () => {
    const fut = await futFuturo();
    await armar(db, jogador.id, fut.id, inventarioId);
    await escalar(fut, jogador);
    await db.transaction((tx) => congelarMultiplicadores(tx, fut.id, 42));

    // A linha continua existindo — é ela que o fato do replay referencia.
    const [item] = await db
      .select()
      .from(zenhaInventario)
      .where(eq(zenhaInventario.id, inventarioId));
    expect(item.consumidoEm).not.toBeNull();

    // E não é mais oferecida nem armável.
    const situacao = await situacaoDoMultiplicador(db, jogador.id, fut.id);
    expect(situacao.disponivel).toBeNull();

    const outroFut = await futFuturo();
    expect(await armar(db, jogador.id, outroFut.id, inventarioId)).toBe(
      "multiplicador-indisponivel",
    );
  });

  // O contraponto: o DEVOLVIDO não leva carimbo e continua servindo. Confundir
  // os dois desfechos custaria caro nos dois sentidos — ou item infinito, ou
  // item queimado sem ter sido usado.
  it("o item devolvido continua livre para outro fut", async () => {
    const fut = await futFuturo();
    await armar(db, jogador.id, fut.id, inventarioId);
    // Não escala ninguém: quem não entrou em campo tem o item de volta.
    await db.transaction((tx) => congelarMultiplicadores(tx, fut.id, 42));

    const [item] = await db
      .select()
      .from(zenhaInventario)
      .where(eq(zenhaInventario.id, inventarioId));
    expect(item.consumidoEm).toBeNull();

    const outroFut = await futFuturo();
    expect(await armar(db, jogador.id, outroFut.id, inventarioId)).toBeNull();
  });

  // Encerrar duas vezes não pode consumir dois itens nem duplicar o fato.
  it("congelar duas vezes é idempotente", async () => {
    const fut = await futFuturo();
    await armar(db, jogador.id, fut.id, inventarioId);
    await escalar(fut, jogador);

    await db.transaction((tx) => congelarMultiplicadores(tx, fut.id, 42));
    await db.transaction((tx) => congelarMultiplicadores(tx, fut.id, 42));

    expect(await db.select().from(zenhaMultiplicadores)).toHaveLength(1);
  });

  // O cascade do schema é o que devolve o item quando o fut some — sem uma
  // linha de código de desfazimento.
  it("apagar o fut evapora o fato e libera o item", async () => {
    const fut = await futFuturo();
    await armar(db, jogador.id, fut.id, inventarioId);
    await escalar(fut, jogador);
    await db.transaction((tx) => congelarMultiplicadores(tx, fut.id, 42));

    await db.delete(matchDays).where(eq(matchDays.id, fut.id));

    expect(await db.select().from(zenhaMultiplicadores)).toHaveLength(0);
    // O item continua no inventário da pessoa, pronto para outro fut.
    const [item] = await db
      .select()
      .from(zenhaInventario)
      .where(eq(zenhaInventario.id, inventarioId));
    expect(item).toBeDefined();
    expect(item.armadoMatchDayId).toBeNull();
  });
});

describe("devolverMultiplicadoresSemNota", () => {
  it("devolve quem armou, jogou, e não foi avaliado por ninguém", async () => {
    const fut = await futFuturo();
    await db.insert(zenhaMultiplicadores).values({
      matchDayId: fut.id,
      playerId: jogador.id,
      inventarioId,
      fatorNum: 3,
      fatorDen: 2,
    });

    // Nenhuma linha em skill_history para a rodada 999.
    await db.transaction((tx) => devolverMultiplicadoresSemNota(tx, fut.id, 999));

    expect(await db.select().from(zenhaMultiplicadores)).toHaveLength(0);
  });

  it("mantém o fato de quem foi avaliado", async () => {
    const { fut, roundId } = await futComRodada();
    await db.insert(zenhaMultiplicadores).values({
      matchDayId: fut.id,
      playerId: jogador.id,
      inventarioId,
      fatorNum: 3,
      fatorDen: 2,
    });
    await db.insert(skillHistory).values({
      playerId: jogador.id,
      roundId,
      skillBefore: 5,
      skillAfter: 5.4,
      ratingsCount: 3,
      averageReceived: 7,
    });

    await db.transaction((tx) => devolverMultiplicadoresSemNota(tx, fut.id, roundId));

    expect(await db.select().from(zenhaMultiplicadores)).toHaveLength(1);
  });

  // O ciclo INTEIRO, e não o fato inserido à mão: é a diferença entre os dois
  // que escondia o bug. `congelarMultiplicadores` carimba `consumido_em`, e
  // apagar só o fato deixava o item marcado como gasto para sempre — a pessoa
  // pagava, não tinha efeito na nota, era avisada de que o item "voltou", e
  // não voltava.
  it("o item devolvido volta ARMÁVEL, e não só sem o fato", async () => {
    const fut = await futFuturo();
    const { criarJogo } = await import("@/test/fixtures-avaliacao");
    const { jogador: adversario } = await criarJogadorComConta();
    await armar(db, jogador.id, fut.id, inventarioId);
    await criarJogo(fut, [jogador], [adversario]);

    // Encerra de verdade: é aqui que o `consumido_em` é carimbado.
    await db.transaction((tx) => congelarMultiplicadores(tx, fut.id, 777));
    expect(await consumidoEmDe(inventarioId)).not.toBeNull();

    // Ninguém avaliou na rodada 777 — o item tem que voltar inteiro.
    await db.transaction((tx) => devolverMultiplicadoresSemNota(tx, fut.id, 777));

    expect(await db.select().from(zenhaMultiplicadores)).toHaveLength(0);
    expect(await consumidoEmDe(inventarioId)).toBeNull();
    // A prova final: dá para armar de novo, num fut novo.
    const outroFut = await futFuturo();
    expect(await armar(db, jogador.id, outroFut.id, inventarioId)).toBeNull();
  });
});

// O cascade de `zenha_multiplicadores` apaga o FATO, e só ele: `consumido_em` é
// coluna do inventário e sobrevive. Fut apagado é fut que não aconteceu, então o
// item consumido nele tem que voltar.
describe("apagarFut e o multiplicador", () => {
  it("fut apagado devolve o item que tinha sido consumido nele", async () => {
    const { apagarFut } = await import("./deletion");
    const fut = await futFuturo();
    const { criarJogo } = await import("@/test/fixtures-avaliacao");
    const { jogador: adversario } = await criarJogadorComConta();
    await armar(db, jogador.id, fut.id, inventarioId);
    await criarJogo(fut, [jogador], [adversario]);
    await db.transaction((tx) => congelarMultiplicadores(tx, fut.id, 42));
    expect(await consumidoEmDe(inventarioId)).not.toBeNull();

    await db.transaction((tx) => apagarFut(tx, fut.id, `teste:${fut.id}`));

    expect(await db.select().from(zenhaMultiplicadores)).toHaveLength(0);
    expect(await consumidoEmDe(inventarioId)).toBeNull();
    const outroFut = await futFuturo();
    expect(await armar(db, jogador.id, outroFut.id, inventarioId)).toBeNull();
  });

  it("fut apagado antes do encerramento solta o arme por inteiro", async () => {
    const { apagarFut } = await import("./deletion");
    const fut = await futFuturo();
    await armar(db, jogador.id, fut.id, inventarioId);

    await db.transaction((tx) => apagarFut(tx, fut.id, `teste:${fut.id}`));

    // A FK zera `armado_match_day_id` sozinha, mas as duas companheiras são
    // código nosso — e são as três juntas que significam "armado".
    const arme = await armeDe(inventarioId);
    expect(arme.matchDayId).toBeNull();
    expect(arme.armadoEm).toBeNull();
    expect(arme.cortePrevisto).toBeNull();
  });
});

// Sem esta varredura o item fica preso para sempre: `desarmar` recusa depois do
// kickoff, e a única outra liberação é o encerramento, que nunca vem.
describe("soltarArmesDeFutsAbandonados", () => {
  /**
   * Um fut que começou há N dias e continua aberto.
   *
   * `sql.raw` no número: interpolado normal ele viraria parâmetro ligado sem
   * tipo, e `date - $1` não resolve — o Postgres recusa com "column date is of
   * type date but expression is of type integer". O valor vem daqui do teste,
   * nunca de entrada externa.
   */
  const futAbandonado = (dias: number) =>
    criarFut({
      date: sql`((now() at time zone 'America/Sao_Paulo')::date - ${sql.raw(String(dias))})` as unknown as string,
      startTime: "20:00",
    });

  it("solta o arme de um fut que passou da hora e ninguém encerrou", async () => {
    const fut = await futAbandonado(10);
    // Armado quando ainda dava (o `WHERE` de `armar` recusaria agora).
    await db
      .update(zenhaInventario)
      .set({ armadoMatchDayId: fut.id, armadoEm: sql`now()`, cortePrevisto: sql`now()` })
      .where(eq(zenhaInventario.id, inventarioId));

    expect(await db.transaction((tx) => soltarArmesDeFutsAbandonados(tx))).toBe(1);

    const arme = await armeDe(inventarioId);
    expect(arme.matchDayId).toBeNull();
    expect(arme.armadoEm).toBeNull();
    // Volta ARMÁVEL: nunca foi consumido, então não ganha carimbo de gasto.
    expect(await consumidoEmDe(inventarioId)).toBeNull();
    const novo = await futFuturo();
    expect(await armar(db, jogador.id, novo.id, inventarioId)).toBeNull();
  });

  it("não mexe no fut que ainda vai acontecer nem no recém-passado", async () => {
    const fut = await futFuturo();
    await armar(db, jogador.id, fut.id, inventarioId);
    expect(await db.transaction((tx) => soltarArmesDeFutsAbandonados(tx))).toBe(0);
    expect((await armeDe(inventarioId)).matchDayId).toBe(fut.id);

    // Encerrar dias depois é rotina — soltar aqui devolveria item de fut que
    // ainda vai ser fechado.
    const recente = await futAbandonado(2);
    await db
      .update(zenhaInventario)
      .set({ armadoMatchDayId: recente.id })
      .where(eq(zenhaInventario.id, inventarioId));
    expect(await db.transaction((tx) => soltarArmesDeFutsAbandonados(tx))).toBe(0);
  });

  it("não mexe no fut encerrado — lá quem resolve é o congelamento", async () => {
    const fut = await futAbandonado(10);
    await db
      .update(zenhaInventario)
      .set({ armadoMatchDayId: fut.id })
      .where(eq(zenhaInventario.id, inventarioId));
    await db.update(matchDays).set({ status: "finished" }).where(eq(matchDays.id, fut.id));

    expect(await db.transaction((tx) => soltarArmesDeFutsAbandonados(tx))).toBe(0);
    expect((await armeDe(inventarioId)).matchDayId).toBe(fut.id);
  });
});

describe("lerMultiplicadoresPorRodada", () => {
  it("liga o fato do fut à rodada, para o replay consumir", async () => {
    const { fut, roundId } = await futComRodada();
    await db.insert(zenhaMultiplicadores).values({
      matchDayId: fut.id,
      playerId: jogador.id,
      inventarioId,
      fatorNum: 3,
      fatorDen: 2,
    });

    const mapa = await lerMultiplicadoresPorRodada(db, [roundId]);
    expect(mapa.get(roundId)?.get(jogador.id)).toEqual({ num: 3, den: 2 });
  });

  it("devolve mapa vazio sem rodadas", async () => {
    expect((await lerMultiplicadoresPorRodada(db, [])).size).toBe(0);
  });
});

/** Um fut encerrado com uma rodada de avaliação aberta. */
async function futComRodada(): Promise<{ fut: MatchDay; roundId: number }> {
  const { ratingRounds } = await import("@/db/schema");
  const fut = await criarFut({ status: "finished" });
  const [rodada] = await db
    .insert(ratingRounds)
    .values({ matchDayId: fut.id, deadlineAt: sql`now() + interval '36 hours'` })
    .returning({ id: ratingRounds.id });
  return { fut, roundId: rodada.id };
}
