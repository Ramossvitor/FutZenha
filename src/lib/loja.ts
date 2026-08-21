import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, type Executor } from "@/db";
import { matchDays, zenhaEquipados, zenhaInventario } from "@/db/schema";
import { debitar, getSaldo } from "./carteira";
import {
  CATALOGO,
  ehIdDeItem,
  ID_DO_MULTIPLICADOR,
  itensAVenda,
  precoVigente,
  type IdDeItem,
  type ItemDaLoja,
  type SlotDeExibicao,
} from "./loja-catalogo";
import { comSobrescritas, precoDoMultiplicador, type Ajustes } from "./zenha";
import { lerSobrescritas } from "./zenha-config";

// A loja: a vitrine, a compra e o inventário.
//
// O catálogo (src/lib/loja-catalogo.ts) diz o que existe e o motor da zenha
// (src/lib/zenha.ts) diz quanto custa; aqui só se resolve o que o BANCO sabe —
// quem já tem o quê, quanto o multiplicador já subiu neste mês, e o que está
// equipado. Nenhuma linha daqui sabe somar saldo: isso é de carteira.ts, e a
// única porta de saída de zenha continua sendo `debitar`.
//
// ── A regra que sustenta a compra ───────────────────────────────────────────
//
// Entregar o item e cobrar por ele são DUAS escritas, e elas caem juntas ou não
// caem. A ordem é sempre insert-depois-débito, nunca o contrário: o débito
// precisa da `dedupe_key`, e a chave usa o id da linha do INVENTÁRIO — com
// `compra:{itemId}` o segundo multiplicador do mês sairia de graça, engolido
// pela unique. Débito recusado LANÇA para o rollback desfazer o insert; nunca se
// devolve item sem cobrar.

/** Por que a compra não aconteceu. `null` é a compra feita. */
export type ErroDeCompra =
  /** Item aposentado — some da vitrine, mas o link direto continua existindo. */
  | "item-indisponivel"
  /** Cosmético que ele já tem. Nada foi cobrado. */
  | "ja-possui"
  | "sem-saldo";

/** Por que o item não foi para o slot. */
export type ErroDeEquipar =
  /** Não é dele, não existe, ou é o consumível — que não fica pendurado no perfil. */
  "item-nao-e-seu";

export type ItemDaVitrine = {
  item: ItemDaLoja;
  /**
   * O que ESTA compra cobra deste jogador, agora. No multiplicador é o degrau
   * dele da escada, e não o preço de tabela — a vitrine tem que dizer o número
   * que vai sair da carteira.
   */
  preco: number;
  /** Cosmético que ele já tem. Sempre `false` no consumível, que é recomprável. */
  possui: boolean;
};

export type Vitrine = {
  saldo: number;
  itens: ItemDaVitrine[];
  /** Multiplicadores comprados no mês corrente — a escada já subiu tudo isto. */
  multiplicadoresNoMes: number;
  /**
   * A força que o multiplicador comprado HOJE teria (150 = 1,5×).
   *
   * Sai daqui, e não de uma segunda leitura do `zenha_config` na tela: é o mesmo
   * SELECT que resolve os preços, e o número que a vitrine promete tem que ser
   * o mesmo que a compra vai congelar em `fator_percent`.
   */
  fatorDoMultiplicador: number;
};

/**
 * Sinal interno de "não tinha saldo", só para o `throw` que desfaz o insert.
 *
 * Uma classe, e não uma string qualquer: o `catch` de `comprar` precisa
 * distinguir a recusa esperada de um erro de verdade do banco, e engolir tudo
 * ali transformaria queda de conexão em "sem saldo" na tela.
 */
class SaldoInsuficiente extends Error {}

/**
 * O preço que a compra vai cobrar deste item, agora.
 *
 * O consumível não passa por `precoVigente` porque aquela função responde
 * sempre pelo PRIMEIRO degrau (é o que a vitrine de quem ainda não comprou
 * nenhum no mês precisa). Aqui o degrau é o do jogador, e é esta função — uma
 * só — que a vitrine e a compra chamam, para o número da tela e o número do
 * débito não terem como divergir.
 */
function precoParaEste(
  item: ItemDaLoja,
  ajustes: Ajustes,
  sobrescritas: ReadonlyMap<string, number>,
  multiplicadoresNoMes: number,
): number {
  if (item.id !== ID_DO_MULTIPLICADOR) return precoVigente(item.id, sobrescritas);
  return precoDoMultiplicador(ajustes.multiplicador_preco_base, multiplicadoresNoMes);
}

/**
 * A chave do lock por jogador da compra de consumível.
 *
 * O cosmético não precisa dela: o índice parcial `zenha_inventario_unico_idx`
 * serializa a segunda compra por conta do banco. O consumível não tem índice
 * nenhum — comprar de novo é o comportamento esperado —, e o preço dele vem de
 * uma ESCADA lida com `count(*)`. Sob READ COMMITTED, duas compras simultâneas
 * leem as duas o mesmo zero, calculam as duas o primeiro degrau e passam as
 * duas: quatro multiplicadores por 4×120 em vez de 120+160+210+280, que é
 * exatamente a rotina que a escada existe para impedir. A carteira não salva
 * disso — ela serializa o DINHEIRO, mas o preço já veio errado.
 *
 * `pg_advisory_xact_lock` de dois argumentos (chave, jogador), e não a linha da
 * carteira com `FOR UPDATE`: a carteira pode ainda não existir (ela nasce no
 * primeiro crédito), e `FOR UPDATE` não tranca linha que não há. Lock de
 * TRANSAÇÃO pela mesma razão do LOCK_NOTA: solta sozinho no commit ou rollback,
 * e é o único seguro sob o pooler em transaction mode (ver src/db/index.ts).
 *
 * Sem `try_`, ao contrário do varredor: aqui há um humano esperando resposta, e
 * a segunda compra deve ACONTECER pelo preço certo, não ser descartada.
 */
const LOCK_COMPRA = 573914028;

/**
 * Quantos multiplicadores este jogador comprou no mês CORRENTE.
 *
 * `date_trunc('month', now())` do Postgres, e nunca uma data montada em
 * JavaScript: o relógio que decide de que mês é a compra tem que ser o mesmo
 * que carimbou `adquirido_em`, senão o fuso do runtime vira preço errado nas
 * primeiras (e nas últimas) horas do mês.
 *
 * Conta a linha do inventário, e não o ledger: é a linha do inventário que
 * sobrevive ao item ser armado, consumido e virar fato — a escada mede COMPRA,
 * não item disponível.
 */
async function contarMultiplicadoresDoMes(exec: Executor, playerId: number): Promise<number> {
  const [linha] = await exec
    .select({ total: sql<number>`count(*)::int` })
    .from(zenhaInventario)
    .where(
      and(
        eq(zenhaInventario.playerId, playerId),
        eq(zenhaInventario.itemId, ID_DO_MULTIPLICADOR),
        sql`${zenhaInventario.adquiridoEm} >= date_trunc('month', now())`,
      ),
    );
  return linha?.total ?? 0;
}

/** Os cosméticos que ele já tem, para a vitrine marcá-los em vez de vendê-los de novo. */
async function idsQueJaTem(exec: Executor, playerId: number): Promise<Set<string>> {
  const linhas = await exec
    .select({ itemId: zenhaInventario.itemId })
    .from(zenhaInventario)
    .where(and(eq(zenhaInventario.playerId, playerId), eq(zenhaInventario.consumivel, false)));
  return new Set(linhas.map((l) => l.itemId));
}

/**
 * A vitrine deste jogador: o que está à venda, por quanto, e o que ele já tem.
 *
 * As quatro leituras em paralelo porque nenhuma depende da outra e esta é a
 * página inteira — em série seriam quatro idas ao banco no caminho crítico.
 *
 * Item aposentado não entra (é `itensAVenda` quem filtra) e continua funcionando
 * no inventário de quem comprou: a regra do catálogo é aposentar, nunca apagar.
 */
export async function getVitrine(playerId: number): Promise<Vitrine> {
  const [saldo, sobrescritas, possuidos, multiplicadoresNoMes] = await Promise.all([
    getSaldo(playerId),
    lerSobrescritas(db),
    idsQueJaTem(db, playerId),
    contarMultiplicadoresDoMes(db, playerId),
  ]);
  const ajustes = comSobrescritas(sobrescritas);

  return {
    saldo,
    multiplicadoresNoMes,
    fatorDoMultiplicador: ajustes.multiplicador_fator,
    itens: itensAVenda().map((item) => ({
      item,
      preco: precoParaEste(item, ajustes, sobrescritas, multiplicadoresNoMes),
      possui: !item.consumivel && possuidos.has(item.id),
    })),
  };
}

/**
 * Compra. Devolve o slug do que impediu, ou `null` quando entregou e cobrou.
 *
 * Tudo numa transação porque as duas escritas são inseparáveis, e o preço é
 * resolvido DENTRO dela: ler o `zenha_config` fora abriria a janela em que o
 * admin muda o preço entre a leitura e o débito.
 *
 * O `onConflictDoNothing` do cosmético carrega o predicado do índice parcial
 * (`consumivel = false`) porque sem ele o Postgres não infere o índice e recusa
 * o comando inteiro. Zero linhas devolvidas é "já possui" — e é aí que a compra
 * PARA, antes do débito: sem esse corte, o segundo clique no mesmo badge cobrava
 * de novo por um item que a pessoa já tinha.
 *
 * O consumível não tem esse índice para se apoiar — ele é comprável várias
 * vezes de propósito —, e é justamente ele que tem preço em ESCADA. Daí o
 * advisory lock: ver `LOCK_COMPRA`.
 */
export async function comprar(playerId: number, itemId: IdDeItem): Promise<ErroDeCompra | null> {
  const item = CATALOGO[itemId];
  // Aposentado sai da vitrine, mas a rota `/loja/[item]` continua respondendo —
  // link velho no zap, aba aberta desde antes. A recusa mora aqui, e não só na
  // tela, porque a tela não é trava.
  if (item.aposentado) return "item-indisponivel";

  try {
    return await db.transaction(async (tx) => {
      // Antes de LER a escada, não depois: `contarMultiplicadoresDoMes` é um
      // `count(*)` e nada o serializa sozinho. Ver `LOCK_COMPRA`.
      if (item.consumivel) {
        await tx.execute(
          sql`select pg_advisory_xact_lock(${LOCK_COMPRA}::int, ${playerId}::int)`,
        );
      }

      const sobrescritas = await lerSobrescritas(tx);
      const ajustes = comSobrescritas(sobrescritas);
      const preco = precoParaEste(
        item,
        ajustes,
        sobrescritas,
        // Só o consumível tem escada, e só ele paga esta consulta.
        item.consumivel ? await contarMultiplicadoresDoMes(tx, playerId) : 0,
      );

      const valores = {
        playerId,
        itemId,
        // Congelado: o admin mexe no preço amanhã e o que a pessoa pagou
        // continua sendo o que ela pagou.
        precoPago: preco,
        consumivel: item.consumivel,
        // O fator vigente vira propriedade DESTE item no instante da compra. Sem
        // o congelamento, baixar a força do multiplicador no painel enfraqueceria
        // retroativamente o que já estava comprado e guardado.
        fatorPercent: item.consumivel ? ajustes.multiplicador_fator : null,
      };

      // Um insert só para os dois casos: o `onConflictDoNothing` carrega o
      // predicado do índice parcial (`consumivel = false`), e o consumível
      // simplesmente não está nesse índice — ele nunca conflita, então o
      // `ON CONFLICT` é inerte para ele. Ramificar aqui escreveria duas vezes o
      // mesmo insert para dizer uma distinção que o índice já faz.
      const [novo] = await tx
        .insert(zenhaInventario)
        .values(valores)
        .onConflictDoNothing({
          target: [zenhaInventario.playerId, zenhaInventario.itemId],
          where: sql`${zenhaInventario.consumivel} = false`,
        })
        .returning({ id: zenhaInventario.id });

      if (!novo) return "ja-possui";

      // Preço zero é decisão legítima do admin — o mínimo do ajuste e o do preço
      // de item são os dois 0 —, e não dá para mandá-lo ao débito: o ledger tem
      // `check (amount <> 0)` e `debitar` lança em valor não-positivo. Item de
      // graça entra no inventário sem linha no extrato, que é a leitura honesta
      // do que aconteceu — e o fecho `saldo == sum(amount)` continua de pé.
      if (preco === 0) return null;

      const saldo = await debitar(tx, playerId, preco, `compra:${novo.id}`, `Comprou ${item.nome}`, {
        inventarioId: novo.id,
      });
      // `debitar` não escreveu nada quando devolve null, mas o INSERT acima já
      // escreveu. Lançar é o que desfaz os dois — devolver aqui entregaria o
      // item de graça.
      if (saldo === null) throw new SaldoInsuficiente();

      return null;
    });
  } catch (erro) {
    if (erro instanceof SaldoInsuficiente) return "sem-saldo";
    throw erro;
  }
}

export type ItemDoInventario = {
  inventarioId: number;
  item: ItemDaLoja;
  precoPago: number;
  adquiridoEm: Date;
  /** O percentual congelado na compra (150 = 1,5×). Nulo fora do multiplicador. */
  fatorPercent: number | null;
  /** O slot em que ele está aparecendo no perfil, ou `null` se está guardado. */
  equipadoEm: SlotDeExibicao | null;
  /** O fut em que este consumível está armado. Nulo quando está livre. */
  armadoNo: { id: number; data: string; local: string } | null;
  /**
   * Quando o consumível foi gasto. Nulo = ainda dá para armar.
   *
   * A linha continua aqui depois de consumida porque o fato que o replay da
   * nota lê (`zenha_multiplicadores`) aponta para ela — apagar evaporaria o
   * insumo do cálculo. Esta marca é o que separa "usado" de "livre".
   */
  consumidoEm: Date | null;
};

/**
 * O inventário: o que é dele, o que está equipado e onde cada consumível está
 * armado.
 *
 * Uma consulta com dois LEFT JOINs, e não três idas ao banco: `zenha_equipados`
 * tem `inventario_id` unique e o arme é uma coluna da própria linha, então
 * nenhum dos dois multiplica linha.
 *
 * O `item_id` que o catálogo não conhece morre aqui, CALADO — a mesma decisão
 * (e a mesma razão) do perfil público: a regra é nunca apagar entrada do
 * catálogo, e o preço de alguém quebrá-la um dia tem que ser um item que sumiu
 * da lista, nunca a página inteira em 500.
 */
export async function getInventario(playerId: number): Promise<ItemDoInventario[]> {
  const linhas = await db
    .select({
      id: zenhaInventario.id,
      itemId: zenhaInventario.itemId,
      precoPago: zenhaInventario.precoPago,
      adquiridoEm: zenhaInventario.adquiridoEm,
      fatorPercent: zenhaInventario.fatorPercent,
      consumidoEm: zenhaInventario.consumidoEm,
      slot: zenhaEquipados.slot,
      futId: matchDays.id,
      futData: matchDays.date,
      futLocal: matchDays.location,
    })
    .from(zenhaInventario)
    .leftJoin(zenhaEquipados, eq(zenhaEquipados.inventarioId, zenhaInventario.id))
    .leftJoin(matchDays, eq(matchDays.id, zenhaInventario.armadoMatchDayId))
    .where(eq(zenhaInventario.playerId, playerId))
    .orderBy(desc(zenhaInventario.adquiridoEm), desc(zenhaInventario.id));

  return linhas.flatMap((l) =>
    ehIdDeItem(l.itemId)
      ? [
          {
            inventarioId: l.id,
            item: CATALOGO[l.itemId],
            precoPago: l.precoPago,
            adquiridoEm: l.adquiridoEm,
            fatorPercent: l.fatorPercent,
            consumidoEm: l.consumidoEm,
            equipadoEm: l.slot,
            armadoNo:
              l.futId !== null ? { id: l.futId, data: l.futData!, local: l.futLocal! } : null,
          },
        ]
      : [],
  );
}

/**
 * Põe o item no slot dele. Devolve o slug do erro, ou `null`.
 *
 * `onConflictDoUpdate` na PK `(player_id, slot)`, e NUNCA "apaga o que está lá e
 * insere o novo": entre as duas escritas existiria um instante em que o slot
 * está vazio, e uma falha ali deixaria a pessoa sem o item que ela tinha e sem o
 * que ela pediu. O upsert troca o ocupante numa statement só.
 *
 * O slot sai do CATÁLOGO, e não do cliente: o formulário manda o id da linha do
 * inventário e mais nada. Quem manda o slot escolhe onde o próprio item aparece
 * — e um badge declarado como "titulo" ocuparia dois lugares no perfil.
 *
 * A posse é conferida no `WHERE` da leitura, dentro da mesma transação da
 * escrita. Item não muda de dono (não existe caminho que reescreva
 * `zenha_inventario.player_id`), então ler e escrever no mesmo commit é o
 * bastante para o id de outra pessoa não virar cosmético no perfil de quem
 * mandou o POST.
 */
export async function equipar(
  playerId: number,
  inventarioId: number,
): Promise<ErroDeEquipar | null> {
  return db.transaction(async (tx) => {
    const [linha] = await tx
      .select({ itemId: zenhaInventario.itemId })
      .from(zenhaInventario)
      .where(and(eq(zenhaInventario.id, inventarioId), eq(zenhaInventario.playerId, playerId)));

    // Não é dele, não existe, ou o catálogo não conhece o id. As três coisas dão
    // a mesma resposta de propósito: distinguir "não existe" de "existe e não é
    // seu" transformaria o formulário num oráculo do inventário alheio.
    if (!linha || !ehIdDeItem(linha.itemId)) return "item-nao-e-seu";

    const slot = CATALOGO[linha.itemId].slot;
    // Consumível não tem slot: ele se arma num fut, não se pendura no perfil.
    if (slot === null) return "item-nao-e-seu";

    await tx
      .insert(zenhaEquipados)
      .values({ playerId, slot, inventarioId })
      .onConflictDoUpdate({
        target: [zenhaEquipados.playerId, zenhaEquipados.slot],
        // `now()` do Postgres, nunca `new Date()` em sql cru — regra do driver.
        set: { inventarioId, equipadoEm: sql`now()` },
      });

    return null;
  });
}

/**
 * Esvazia um slot.
 *
 * Sem erro nenhum: desequipar o que já não está equipado é exatamente o estado
 * que a pessoa pediu, e um banner de erro para isso seria ruído (dois toques
 * seguidos no mesmo botão, aba velha reenviada). O `player_id` no `WHERE` é o
 * que impede o slot de outra pessoa de ser esvaziado por um POST forjado.
 */
export async function desequipar(playerId: number, slot: SlotDeExibicao): Promise<void> {
  await db
    .delete(zenhaEquipados)
    .where(and(eq(zenhaEquipados.playerId, playerId), eq(zenhaEquipados.slot, slot)));
}
