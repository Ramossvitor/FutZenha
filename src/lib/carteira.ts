import "server-only";
import { cache } from "react";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db, type Executor } from "@/db";
import { zenhaCarteiras, zenhaLedger, type ZenhaLedgerEntry } from "@/db/schema";
import type { CreditoDeZenha } from "./zenha";

// A carteira e o extrato: as únicas quatro portas por onde zenha entra e sai.
//
// O saldo é MATERIALIZADO em `zenha_carteiras`, e não `sum(zenha_ledger.amount)`
// — por duas coisas que a soma não dá: uma linha para o UPDATE condicional
// travar (é ele que serializa a compra concorrente, sem lock nenhum) e o
// `check (saldo >= 0)` do banco. O preço dessa escolha é a duplicação, e o fecho
// dela — `saldo == sum(amount)` de cada jogador — é cobrado ao fim de todo
// cenário do teste de integração.
//
// Mover zenha são sempre DUAS escritas (a linha do extrato e o saldo), e o fecho
// só sobrevive se as duas caírem juntas. Por isso `creditar` e `debitar` abrem
// transação própria quando recebem o `db` global: sem ela cada statement
// committa sozinho, e o `Executor` do contrato não expõe `transaction` para o
// tipo cobrar isso de quem chama.

/** Uma página do extrato. Fora daqui o número não é configurável de propósito. */
const LINHAS_POR_PAGINA = 50;

/**
 * Cria a linha da carteira zerada, se ainda não existir.
 *
 * NÃO credita nada, e não existe saldo de estreia: todo mundo começa em zero e
 * a única porta de entrada é a liquidação do fut (src/lib/zenha-engine.ts).
 * Zenha se ganha jogando.
 *
 * Uma carteira que nascesse com saldo teria dinheiro sem linha de origem — e o
 * fecho `saldo == sum(amount)` quebraria já no primeiro jogador.
 */
export async function garantirCarteira(exec: Executor, playerId: number): Promise<void> {
  await exec.insert(zenhaCarteiras).values({ playerId, saldo: 0 }).onConflictDoNothing();
}

/**
 * Paga um lote de créditos: as linhas entram no ledger e só o que ENTROU soma na
 * carteira.
 *
 * A idempotência é da unique `(player_id, dedupe_key)`: o varredor pode passar
 * duas vezes pelo mesmo fut que o segundo insert não faz nada. Por isso o saldo
 * é somado a partir do `.returning()`, e não do que foi pedido — pedir e ter
 * entrado são coisas diferentes toda vez que a liquidação repete.
 */
export async function creditar(
  exec: Executor,
  linhas: readonly CreditoDeZenha[],
): Promise<void> {
  if (linhas.length === 0) return;

  // Amount negativo aqui DEBITARIA sem passar pelo `saldo >= valor` do débito —
  // e o `check (saldo >= 0)` só pegaria quando estourasse o zero, ou seja, o
  // rombo pequeno passaria calado. Zero cairia no `check (amount <> 0)` já
  // depois de o lote inteiro ter sido montado. Nenhuma fonte de zenha.ts produz
  // isso hoje; falhar alto é o que garante que continue assim.
  for (const l of linhas) {
    if (!Number.isInteger(l.amount) || l.amount <= 0) {
      throw new Error(
        `Crédito inválido: ${l.amount} para o jogador ${l.playerId}. ` +
          "O valor tem que ser inteiro e positivo — estorno não existe na zenha.",
      );
    }
  }

  // O ledger e a carteira têm que cair juntos: com o `db` global, morrer entre
  // as duas escritas deixaria as linhas no extrato sem o saldo — e a
  // retentativa NÃO conserta, porque a unique de dedupe faz o segundo insert
  // não devolver nada e a soma nunca chega à carteira. Quem já vem de dentro de
  // uma transação compõe nela; quem vem com o `db` ganha uma.
  if (exec === db) return db.transaction((tx) => creditarCom(tx, linhas));
  return creditarCom(exec, linhas);
}

async function creditarCom(exec: Executor, linhas: readonly CreditoDeZenha[]): Promise<void> {
  // Ordenado por jogador aqui também: o insert do ledger disputa as mesmas
  // entradas de índice único que outra liquidação concorrente, e duas ordens
  // diferentes de aquisição é a receita do deadlock.
  const aInserir = [...linhas]
    .sort((a, b) => a.playerId - b.playerId)
    .map((l) => ({
      playerId: l.playerId,
      motivo: l.motivo,
      amount: l.amount,
      dedupeKey: l.dedupeKey,
      descricao: l.descricao,
      // As duas FKs são `set null`: apagar o fut corta o ponteiro e deixa a
      // linha do extrato de pé, legível pela `descricao` congelada. Guardá-las
      // é o que permite a linha do extrato levar de volta ao fut enquanto ele
      // existe — a `dedupe_key` tem o id, mas ela é chave, não navegação.
      matchDayId: l.matchDayId ?? null,
      roundId: l.roundId ?? null,
      pedidoId: l.pedidoId ?? null,
    }));

  const entraram = await exec
    .insert(zenhaLedger)
    .values(aInserir)
    .onConflictDoNothing({ target: [zenhaLedger.playerId, zenhaLedger.dedupeKey] })
    .returning({ playerId: zenhaLedger.playerId, amount: zenhaLedger.amount });

  if (entraram.length === 0) return;

  // AGREGAR POR JOGADOR ANTES DO UPSERT NÃO É OTIMIZAÇÃO — é o que impede o erro.
  // Um mesmo fut paga participação E nota ao mesmo jogador, ou seja, duas linhas
  // com a MESMA conflict key (`player_id`) no mesmo INSERT. O Postgres recusa
  // isso com "ON CONFLICT DO UPDATE command cannot affect row a second time", e
  // recusaria em produção na primeira liquidação de verdade — o cenário é o
  // normal, não o raro. Somar antes deixa uma linha por jogador no comando.
  //
  // E ordenado por player_id: com dois lotes concorrentes tocando os mesmos
  // jogadores, ordem de lock determinística é o que evita o deadlock. O Postgres
  // trava as linhas na ordem em que elas aparecem no VALUES.
  const porJogador = new Map<number, number>();
  for (const l of entraram) porJogador.set(l.playerId, (porJogador.get(l.playerId) ?? 0) + l.amount);
  const totais = [...porJogador].sort(([a], [b]) => a - b);

  // Este upsert também É o `garantirCarteira` do lote: jogador sem linha entra
  // com o total exato, jogador com linha soma. Um insert de zeros antes seria
  // uma ida ao banco que não muda nenhum resultado.
  await exec
    .insert(zenhaCarteiras)
    .values(totais.map(([playerId, total]) => ({ playerId, saldo: total })))
    .onConflictDoUpdate({
      target: zenhaCarteiras.playerId,
      set: {
        saldo: sql`${zenhaCarteiras.saldo} + excluded.saldo`,
        atualizadoEm: sql`now()`,
      },
    });
}

/**
 * Debita a compra. Devolve o saldo novo, ou `null` quando não havia saldo.
 *
 * O `UPDATE ... WHERE saldo >= $valor ... RETURNING` É a serialização — não há
 * advisory lock nem `FOR UPDATE` aqui, de propósito. Duas compras simultâneas
 * disputam a MESMA linha da carteira: a segunda espera a primeira commitar,
 * reavalia o `WHERE` sobre o saldo já debitado e volta com zero linhas. É o
 * mesmo idioma do `UPDATE ... WHERE status = 'open' RETURNING` de `fecharRodada`
 * (src/lib/ratings-engine.ts), e é a razão de o saldo ser materializado: com
 * `sum(amount)` não haveria linha para travar, as duas leriam a mesma soma e as
 * duas passariam.
 *
 * Quem chama tem que estar dentro de uma transação junto com a criação do item —
 * debitar e não entregar é o único jeito de perder dinheiro aqui.
 */
export async function debitar(
  exec: Executor,
  playerId: number,
  valor: number,
  dedupeKey: string,
  descricao: string,
  extra: { inventarioId?: number } = {},
): Promise<number | null> {
  // Valor não-positivo não é "compra recusada", é bug de quem chamou: um débito
  // de zero cairia no `check (amount <> 0)` do ledger e um negativo CREDITARIA
  // sem passar por regra nenhuma. Lançar aqui é achar isso no teste, não no
  // extrato de alguém.
  if (!Number.isInteger(valor) || valor <= 0) {
    throw new Error(`Débito inválido: ${valor}. O valor tem que ser inteiro e positivo.`);
  }

  // Mesma razão do `creditar`: o desconto da carteira e a linha do extrato são
  // dois statements, e sem transação em volta o desconto já committou quando a
  // unique do dedupe estoura — saldo menor que a soma do extrato, para sempre.
  // É o que torna defensável recusar `onConflictDoNothing` lá embaixo.
  if (exec === db) {
    return db.transaction((tx) => debitarCom(tx, playerId, valor, dedupeKey, descricao, extra));
  }
  return debitarCom(exec, playerId, valor, dedupeKey, descricao, extra);
}

async function debitarCom(
  exec: Executor,
  playerId: number,
  valor: number,
  dedupeKey: string,
  descricao: string,
  extra: { inventarioId?: number },
): Promise<number | null> {
  await garantirCarteira(exec, playerId);

  const [carteira] = await exec
    .update(zenhaCarteiras)
    .set({ saldo: sql`${zenhaCarteiras.saldo} - ${valor}`, atualizadoEm: sql`now()` })
    .where(and(eq(zenhaCarteiras.playerId, playerId), gte(zenhaCarteiras.saldo, valor)))
    .returning({ saldo: zenhaCarteiras.saldo });

  // Zero linhas = saldo insuficiente. Nada foi escrito, nem no ledger.
  if (!carteira) return null;

  // Sem `onConflictDoNothing`: aqui a carteira JÁ foi debitada, e engolir o
  // conflito deixaria o saldo menor que a soma do ledger — o fecho quebrado em
  // silêncio, que é exatamente o que o extrato não pode ter. A unique é o alarme
  // e o rollback da transação é o desfecho certo. Chave repetida em compra é bug
  // de quem monta a chave (ela usa o id da linha do inventário, que é novo a
  // cada compra), não retentativa legítima.
  await exec.insert(zenhaLedger).values({
    playerId,
    motivo: "compra",
    amount: -valor,
    dedupeKey,
    descricao,
    inventarioId: extra.inventarioId ?? null,
  });

  return carteira.saldo;
}

/**
 * O saldo do jogador. `cache()` porque o cabeçalho, a loja e o perfil pedem o
 * mesmo número no mesmo render — a mesma razão do `contarNaoLidas`.
 *
 * Zero quando não há linha: jogador criado antes da carteira existir é caso
 * normal (ela nasce no primeiro crédito ou no primeiro débito), e não vale uma
 * escrita no meio de uma leitura só para mostrar "0".
 */
export const getSaldo = cache(async (playerId: number): Promise<number> => {
  const [carteira] = await db
    .select({ saldo: zenhaCarteiras.saldo })
    .from(zenhaCarteiras)
    .where(eq(zenhaCarteiras.playerId, playerId));
  return carteira?.saldo ?? 0;
});

/**
 * Uma página do extrato, da mais recente para a mais antiga.
 *
 * O `id desc` não é enfeite do `created_at desc`: a liquidação de um fut grava
 * participação, nota e MVP no MESMO `now()` (é um insert só), e sem o desempate
 * a ordem dessas linhas mudaria de uma visita para a outra.
 *
 * `temMais` sai de pedir 51 e cortar — um `count(*)` a mais por página custaria
 * uma varredura inteira para responder uma pergunta de sim ou não.
 */
export async function getExtrato(
  playerId: number,
  pagina = 0,
): Promise<{ linhas: ZenhaLedgerEntry[]; temMais: boolean }> {
  // `Number.isFinite` antes do `Math.max`: a página vem de `?p=` na URL, e o
  // `Number("abc")` de quem lê o parâmetro é NaN — que atravessa `Math.max` e
  // `Math.trunc` intacto e vira `offset NaN`, ou seja, 500 no lugar da primeira
  // página. Lixo na URL volta para o começo do extrato.
  const p = Number.isFinite(pagina) ? Math.max(0, Math.trunc(pagina)) : 0;
  const linhas = await db
    .select()
    .from(zenhaLedger)
    .where(eq(zenhaLedger.playerId, playerId))
    .orderBy(desc(zenhaLedger.createdAt), desc(zenhaLedger.id))
    .limit(LINHAS_POR_PAGINA + 1)
    .offset(p * LINHAS_POR_PAGINA);

  return { linhas: linhas.slice(0, LINHAS_POR_PAGINA), temMais: linhas.length > LINHAS_POR_PAGINA };
}
