import "server-only";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db, type Executor } from "@/db";
import {
  lojaItens,
  matchDays,
  zenhaEquipados,
  zenhaInventario,
  zenhaVitrine,
} from "@/db/schema";
import { debitar, getSaldo } from "./carteira";
import {
  VAGAS_NA_VITRINE,
  ehConsumivel,
  slotDoItem,
  type ItemDaLoja,
  type SlotDeExibicao,
} from "./item-da-loja";
import { lerItem, lerItensAVenda } from "./loja-itens";
import { notificar } from "./notifications";
import { comSobrescritas, precoDoMultiplicador } from "./zenha";
import { lerSobrescritas } from "./zenha-config";

// A loja: a vitrine, a compra, o inventário e o que aparece no perfil.
//
// O catálogo (`loja_itens`, lido por src/lib/loja-itens.ts) diz o que existe e
// quanto custa; o motor da zenha (src/lib/zenha.ts) diz como a escada do
// consumível sobe; aqui só se resolve o que o BANCO sabe sobre UM jogador —
// quem já tem o quê, quantos multiplicadores ele comprou no mês, o que está
// equipado e o que está na vitrine. Nenhuma linha daqui sabe somar saldo: isso é
// de carteira.ts, e a única porta de saída de zenha continua sendo `debitar`.
//
// ── A regra que sustenta a compra ───────────────────────────────────────────
//
// Entregar o item e cobrar por ele são DUAS escritas, e elas caem juntas ou não
// caem. A ordem é sempre insert-depois-débito, nunca o contrário: o débito
// precisa da `dedupe_key`, e a chave usa o id da linha do INVENTÁRIO — com
// `compra:{itemId}` o segundo multiplicador do mês sairia de graça, engolido
// pela unique. Débito recusado LANÇA para o rollback desfazer o insert; nunca se
// devolve item sem cobrar.
//
// ── Comprou, apareceu ───────────────────────────────────────────────────────
//
// A compra também COLOCA o item: badge vai para a primeira vaga livre da
// vitrine, cosmético de slot único ocupa o slot se ele estiver vazio. É a
// resposta à pergunta que toda loja de cosmético gera ("comprei, e agora?"), e
// ela nunca pode derrubar a compra — vitrine cheia e slot ocupado são silêncio,
// não erro. O inventário é onde se troca depois.

/** Por que a compra não aconteceu. `null` é a compra feita. */
export type ErroDeCompra =
  /** Item fora de venda (ou que nunca existiu) — o link direto continua existindo. */
  | "item-indisponivel"
  /** Cosmético que ele já tem. Nada foi cobrado. */
  | "ja-possui"
  | "sem-saldo";

/** Por que o item não foi para o slot. */
export type ErroDeEquipar =
  /** Não é dele, não existe, ou não é de slot único (badge e consumível). */
  "item-nao-e-seu";

/** Por que o badge não entrou na vitrine. */
export type ErroDeVitrine =
  /** Não é dele, não existe, ou não é badge. */
  | "item-nao-e-seu"
  /** As cinco vagas estão ocupadas. */
  | "vitrine-cheia";

export type ItemDaVitrine = {
  item: ItemDaLoja;
  /**
   * O que ESTA compra cobra deste jogador, agora. No consumível é o degrau dele
   * da escada, e não o preço de tabela — a vitrine tem que dizer o número que
   * vai sair da carteira.
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
   * SELECT que resolve os ajustes, e o número que a vitrine promete tem que ser
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
 * O consumível é o único com preço variável: `loja_itens.preco` é o primeiro
 * degrau, e os seguintes saem da escada do mês DESTE jogador. Uma função só,
 * chamada pela vitrine e pela compra, para o número da tela e o número do débito
 * não terem como divergir.
 */
function precoParaEste(item: ItemDaLoja, multiplicadoresNoMes: number): number {
  if (!ehConsumivel(item)) return item.preco;
  return precoDoMultiplicador(item.preco, multiplicadoresNoMes);
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
 * O irmão do LOCK_COMPRA, para as escritas na vitrine de UM jogador.
 *
 * Pôr um badge na vitrine é ler as vagas ocupadas e escrever na primeira livre;
 * destacar é apagar o destaque atual e marcar o novo. Os dois são
 * leia-então-escreva sobre o mesmo conjunto de linhas, e dois cliques
 * simultâneos (o botão tocado duas vezes, duas abas) resolveriam a mesma vaga
 * para dois itens. A PK `(player_id, posicao)` recusaria o segundo — com um 500
 * na cara de quem só tocou duas vezes. O lock transforma isso em fila.
 *
 * Chave diferente da compra de propósito: comprar um consumível não tem por que
 * esperar a vitrine de badge do mesmo jogador.
 */
const LOCK_VITRINE = 573914029;

async function travarVitrine(exec: Executor, playerId: number): Promise<void> {
  await exec.execute(sql`select pg_advisory_xact_lock(${LOCK_VITRINE}::int, ${playerId}::int)`);
}

/**
 * Quantos consumíveis este jogador comprou no mês CORRENTE.
 *
 * `date_trunc('month', now())` do Postgres, e nunca uma data montada em
 * JavaScript: o relógio que decide de que mês é a compra tem que ser o mesmo
 * que carimbou `adquirido_em`, senão o fuso do runtime vira preço errado nas
 * primeiras (e nas últimas) horas do mês.
 *
 * Pela coluna `consumivel` do inventário, e não pelo id do item: a coluna foi
 * congelada na compra e sobrevive ao item ser editado no painel do admin. A
 * escada mede COMPRA de consumível, e existe um só.
 */
async function contarMultiplicadoresDoMes(exec: Executor, playerId: number): Promise<number> {
  const [linha] = await exec
    .select({ total: sql<number>`count(*)::int` })
    .from(zenhaInventario)
    .where(
      and(
        eq(zenhaInventario.playerId, playerId),
        eq(zenhaInventario.consumivel, true),
        sql`${zenhaInventario.adquiridoEm} >= date_trunc('month', now())`,
      ),
    );
  return linha?.total ?? 0;
}

/** Os cosméticos que ele já tem, para a vitrine marcá-los em vez de vendê-los de novo. */
async function idsQueJaTem(exec: Executor, playerId: number): Promise<Set<number>> {
  const linhas = await exec
    .select({ itemId: zenhaInventario.itemId })
    .from(zenhaInventario)
    .where(and(eq(zenhaInventario.playerId, playerId), eq(zenhaInventario.consumivel, false)));
  return new Set(linhas.map((l) => l.itemId));
}

/**
 * A vitrine deste jogador: o que está à venda, por quanto, e o que ele já tem.
 *
 * As cinco leituras em paralelo porque nenhuma depende da outra e esta é a
 * página inteira — em série seriam cinco idas ao banco no caminho crítico.
 *
 * Item fora de venda não entra (é `lerItensAVenda` quem filtra) e continua
 * funcionando no inventário e no perfil de quem comprou.
 */
export async function getVitrine(playerId: number): Promise<Vitrine> {
  const [saldo, sobrescritas, possuidos, multiplicadoresNoMes, aVenda] = await Promise.all([
    getSaldo(playerId),
    lerSobrescritas(db),
    idsQueJaTem(db, playerId),
    contarMultiplicadoresDoMes(db, playerId),
    lerItensAVenda(db),
  ]);
  const ajustes = comSobrescritas(sobrescritas);

  return {
    saldo,
    multiplicadoresNoMes,
    fatorDoMultiplicador: ajustes.multiplicador_fator,
    itens: aVenda.map((item) => ({
      item,
      preco: precoParaEste(item, multiplicadoresNoMes),
      possui: !ehConsumivel(item) && possuidos.has(item.id),
    })),
  };
}

/**
 * Põe o badge recém-comprado na primeira vaga livre da vitrine.
 *
 * Devolve `"vitrine-cheia"` sem escrever quando não há vaga. Quem chama de
 * dentro da compra ENGOLE esse retorno: cinco vagas cheias não podem recusar uma
 * compra, e o item vai para o inventário como qualquer outro.
 *
 * O primeiro badge da vitrine vira o destaque sozinho. É a leitura honesta de
 * "só tem um": obrigar um segundo clique para pôr ao lado do nome o único badge
 * que existe seria cerimônia sem escolha.
 *
 * Exige o LOCK_VITRINE tomado por quem chama — daí ele ser privado.
 */
async function porNaVitrineCom(
  exec: Executor,
  playerId: number,
  inventarioId: number,
): Promise<"vitrine-cheia" | null> {
  const ocupadas = await exec
    .select({
      posicao: zenhaVitrine.posicao,
      inventarioId: zenhaVitrine.inventarioId,
      destaque: zenhaVitrine.destaque,
    })
    .from(zenhaVitrine)
    .where(eq(zenhaVitrine.playerId, playerId));

  // Já está lá: pedir de novo é o estado que a pessoa quer, não um erro (dois
  // toques no botão, aba velha reenviada).
  if (ocupadas.some((o) => o.inventarioId === inventarioId)) return null;

  const usadas = new Set(ocupadas.map((o) => o.posicao));
  const vaga = Array.from({ length: VAGAS_NA_VITRINE }, (_, i) => i + 1).find(
    (p) => !usadas.has(p),
  );
  if (vaga === undefined) return "vitrine-cheia";

  await exec.insert(zenhaVitrine).values({
    playerId,
    posicao: vaga,
    inventarioId,
    // Só o PRIMEIRO badge vira destaque sozinho. Vitrine com badges e sem
    // destaque é escolha (ver `tirarDaVitrine`), e o recém-chegado não a desfaz.
    destaque: ocupadas.length === 0,
  });
  return null;
}

/**
 * O item recém-comprado já aparecendo.
 *
 * Nunca falha a compra: o slot ocupado é `onConflictDoNothing` (a PK
 * `(player_id, slot)` é quem recusa) e a vitrine cheia volta como silêncio. Os
 * dois casos são a mesma decisão — a pessoa pagou pelo item, não pelo lugar, e
 * trocar de lugar é no inventário.
 */
async function colocarAoComprar(
  exec: Executor,
  playerId: number,
  inventarioId: number,
  item: ItemDaLoja,
): Promise<void> {
  const slot = slotDoItem(item);
  if (slot !== null) {
    await exec.insert(zenhaEquipados).values({ playerId, slot, inventarioId }).onConflictDoNothing();
    return;
  }
  if (item.tipo === "badge") {
    await travarVitrine(exec, playerId);
    await porNaVitrineCom(exec, playerId, inventarioId);
  }
}

/**
 * Compra. Devolve o slug do que impediu, ou `null` quando entregou e cobrou.
 *
 * Tudo numa transação porque as escritas são inseparáveis, e o ITEM é lido
 * DENTRO dela: ler o preço fora abriria a janela em que o admin muda o preço
 * entre a leitura e o débito, e ler o `ativo` fora abriria a janela em que o
 * item sai de venda entre a tela e o clique.
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
export async function comprar(playerId: number, itemId: number): Promise<ErroDeCompra | null> {
  try {
    return await db.transaction(async (tx) => {
      const item = await lerItem(tx, itemId);
      // Fora de venda some da vitrine, mas a rota `/loja/[item]` continua
      // respondendo — link velho no zap, aba aberta desde antes. A recusa mora
      // aqui, e não só na tela, porque a tela não é trava. Item inexistente dá a
      // MESMA resposta: distinguir os dois faria a URL virar um oráculo de quais
      // ids existem.
      if (!item || !item.ativo) return "item-indisponivel";

      const consumivel = ehConsumivel(item);
      // Antes de LER a escada, não depois: `contarMultiplicadoresDoMes` é um
      // `count(*)` e nada o serializa sozinho. Ver `LOCK_COMPRA`.
      if (consumivel) {
        await tx.execute(sql`select pg_advisory_xact_lock(${LOCK_COMPRA}::int, ${playerId}::int)`);
      }

      const preco = precoParaEste(
        item,
        // Só o consumível tem escada, e só ele paga esta consulta.
        consumivel ? await contarMultiplicadoresDoMes(tx, playerId) : 0,
      );
      // O fator vigente vira propriedade DESTE item no instante da compra. Sem o
      // congelamento, baixar a força do multiplicador no painel enfraqueceria
      // retroativamente o que já estava comprado e guardado.
      const fatorPercent = consumivel
        ? comSobrescritas(await lerSobrescritas(tx)).multiplicador_fator
        : null;

      // Um insert só para os dois casos: o `onConflictDoNothing` carrega o
      // predicado do índice parcial (`consumivel = false`), e o consumível
      // simplesmente não está nesse índice — ele nunca conflita, então o
      // `ON CONFLICT` é inerte para ele. Ramificar aqui escreveria duas vezes o
      // mesmo insert para dizer uma distinção que o índice já faz.
      const [novo] = await tx
        .insert(zenhaInventario)
        .values({
          playerId,
          itemId: item.id,
          // Congelado: o admin mexe no preço amanhã e o que a pessoa pagou
          // continua sendo o que ela pagou.
          precoPago: preco,
          consumivel,
          fatorPercent,
        })
        .onConflictDoNothing({
          target: [zenhaInventario.playerId, zenhaInventario.itemId],
          where: sql`${zenhaInventario.consumivel} = false`,
        })
        .returning({ id: zenhaInventario.id });

      if (!novo) return "ja-possui";

      // Preço zero é decisão legítima do admin, e não dá para mandá-lo ao
      // débito: o ledger tem `check (amount <> 0)` e `debitar` lança em valor
      // não-positivo. Item de graça entra no inventário sem linha no extrato,
      // que é a leitura honesta do que aconteceu — e o fecho
      // `saldo == sum(amount)` continua de pé.
      // O saldo que sobrou, para o recibo mais abaixo. Fica null na compra de
      // preço zero, que não passa pelo débito e portanto não tem saldo lido —
      // e o recibo daquela não fala de saldo nenhum.
      let saldoFinal: number | null = null;
      if (preco > 0) {
        const saldo = await debitar(
          tx,
          playerId,
          preco,
          `compra:${novo.id}`,
          `Comprou ${item.nome}`,
          { inventarioId: novo.id },
        );
        // `debitar` não escreveu nada quando devolve null, mas o INSERT acima já
        // escreveu. Lançar é o que desfaz os dois — devolver aqui entregaria o
        // item de graça.
        if (saldo === null) throw new SaldoInsuficiente();
        saldoFinal = saldo;
      }

      await colocarAoComprar(tx, playerId, novo.id, item);

      // O recibo. Dentro da transação, como todo `notificar()`: se a compra
      // rolar para trás, o aviso vai junto.
      //
      // Comprar era o único gasto de saldo sem aviso nenhum — debitava e
      // redirecionava, e dias depois o extrato era a única memória de para onde
      // as zenhas tinham ido. A linha aqui resolve os três canais de uma vez:
      // caixa de entrada, push e o e-mail de ./email-avisos.
      //
      // A dedupeKey é o id do inventário porque é ele que identifica ESTA
      // compra: o consumível é comprável várias vezes de propósito, e uma chave
      // por (jogador, item) faria a segunda compra do mesmo multiplicador ser
      // engolida pela unique como se fosse repetição.
      await notificar(tx, [
        {
          playerId,
          type: "loja_compra",
          title: `Você comprou ${item.nome}`,
          body:
            preco > 0
              ? `Custou ${preco} zenhas e seu saldo ficou em ${saldoFinal}. O item já está no seu inventário.`
              : `Item de graça, já está no seu inventário.`,
          href: "/perfil/inventario",
          dedupeKey: `loja:compra:${novo.id}`,
        },
      ]);
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
  /** O percentual congelado na compra (150 = 1,5×). Nulo fora do consumível. */
  fatorPercent: number | null;
  /** O slot em que ele está aparecendo no perfil, ou `null` se está guardado. */
  equipadoEm: SlotDeExibicao | null;
  /** Onde este badge está na vitrine, ou `null` se está guardado. */
  naVitrine: { posicao: number; destaque: boolean } | null;
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
 * O inventário: o que é dele, onde cada coisa está aparecendo e onde cada
 * consumível está armado.
 *
 * Uma consulta com um inner join e três LEFT JOINs, e não quatro idas ao banco:
 * `zenha_equipados` e `zenha_vitrine` têm `inventario_id` unique e o arme é uma
 * coluna da própria linha, então nenhum dos três multiplica linha.
 *
 * O join com `loja_itens` é INNER e pode ser: a FK garante que todo `item_id`
 * aponta para uma linha viva, e o `on delete restrict` garante que ela continua
 * viva enquanto houver inventário. Antes disto o catálogo era código e esta
 * função precisava descartar em silêncio o id que ele não conhecesse — o banco
 * passou a responder por isso.
 */
export async function getInventario(playerId: number): Promise<ItemDoInventario[]> {
  const linhas = await db
    .select({
      id: zenhaInventario.id,
      precoPago: zenhaInventario.precoPago,
      adquiridoEm: zenhaInventario.adquiridoEm,
      fatorPercent: zenhaInventario.fatorPercent,
      consumidoEm: zenhaInventario.consumidoEm,
      slot: zenhaEquipados.slot,
      posicao: zenhaVitrine.posicao,
      destaque: zenhaVitrine.destaque,
      futId: matchDays.id,
      futData: matchDays.date,
      futLocal: matchDays.location,
      itemId: lojaItens.id,
      tipo: lojaItens.tipo,
      nome: lojaItens.nome,
      descricao: lojaItens.descricao,
      preco: lojaItens.preco,
      cor: lojaItens.cor,
      imagemHash: lojaItens.imagemHash,
      efeito: lojaItens.efeito,
      ativo: lojaItens.ativo,
    })
    .from(zenhaInventario)
    .innerJoin(lojaItens, eq(lojaItens.id, zenhaInventario.itemId))
    .leftJoin(zenhaEquipados, eq(zenhaEquipados.inventarioId, zenhaInventario.id))
    .leftJoin(zenhaVitrine, eq(zenhaVitrine.inventarioId, zenhaInventario.id))
    .leftJoin(matchDays, eq(matchDays.id, zenhaInventario.armadoMatchDayId))
    .where(eq(zenhaInventario.playerId, playerId))
    .orderBy(desc(zenhaInventario.adquiridoEm), desc(zenhaInventario.id));

  return linhas.map((l) => ({
    inventarioId: l.id,
    item: {
      id: l.itemId,
      tipo: l.tipo,
      nome: l.nome,
      descricao: l.descricao,
      preco: l.preco,
      cor: l.cor,
      imagemHash: l.imagemHash,
      efeito: l.efeito === "multiplicador" ? "multiplicador" : null,
      ativo: l.ativo,
    },
    precoPago: l.precoPago,
    adquiridoEm: l.adquiridoEm,
    fatorPercent: l.fatorPercent,
    consumidoEm: l.consumidoEm,
    equipadoEm: l.slot,
    naVitrine: l.posicao === null ? null : { posicao: l.posicao, destaque: l.destaque! },
    armadoNo: l.futId !== null ? { id: l.futId, data: l.futData!, local: l.futLocal! } : null,
  }));
}

/**
 * Põe o item no slot dele. Devolve o slug do erro, ou `null`.
 *
 * `onConflictDoUpdate` na PK `(player_id, slot)`, e NUNCA "apaga o que está lá e
 * insere o novo": entre as duas escritas existiria um instante em que o slot
 * está vazio, e uma falha ali deixaria a pessoa sem o item que ela tinha e sem o
 * que ela pediu. O upsert troca o ocupante numa statement só.
 *
 * O slot sai do TIPO do item no banco, e não do cliente: o formulário manda o id
 * da linha do inventário e mais nada. Quem manda o slot escolhe onde o próprio
 * item aparece — e um badge declarado como "titulo" ocuparia dois lugares.
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
      .select({ tipo: lojaItens.tipo })
      .from(zenhaInventario)
      .innerJoin(lojaItens, eq(lojaItens.id, zenhaInventario.itemId))
      .where(and(eq(zenhaInventario.id, inventarioId), eq(zenhaInventario.playerId, playerId)));

    // Não é dele ou não existe. Os dois dão a mesma resposta de propósito:
    // distinguir "não existe" de "existe e não é seu" transformaria o formulário
    // num oráculo do inventário alheio.
    if (!linha) return "item-nao-e-seu";

    const slot = slotDoItem({ tipo: linha.tipo });
    // Badge vai para a vitrine e consumível se arma num fut — nenhum dos dois
    // tem slot, e mandar um para cá é formulário forjado.
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

/** Põe um badge do inventário na vitrine do perfil. */
export async function porNaVitrine(
  playerId: number,
  inventarioId: number,
): Promise<ErroDeVitrine | null> {
  return db.transaction(async (tx) => {
    await travarVitrine(tx, playerId);

    const [linha] = await tx
      .select({ tipo: lojaItens.tipo })
      .from(zenhaInventario)
      .innerJoin(lojaItens, eq(lojaItens.id, zenhaInventario.itemId))
      .where(and(eq(zenhaInventario.id, inventarioId), eq(zenhaInventario.playerId, playerId)));
    if (!linha || linha.tipo !== "badge") return "item-nao-e-seu";

    return porNaVitrineCom(tx, playerId, inventarioId);
  });
}

/**
 * Tira o badge da vitrine. A vaga volta a ficar livre e o item continua no
 * inventário.
 *
 * Sem erro, pela mesma razão de `desequipar`. E sem promover ninguém a destaque
 * no lugar: tirar o destaque é um jeito legítimo de não ter badge nenhum ao lado
 * do nome, e escolher um substituto por conta própria seria decidir por quem
 * acabou de decidir.
 */
export async function tirarDaVitrine(playerId: number, inventarioId: number): Promise<void> {
  await db
    .delete(zenhaVitrine)
    .where(
      and(eq(zenhaVitrine.playerId, playerId), eq(zenhaVitrine.inventarioId, inventarioId)),
    );
}

/**
 * Escolhe qual badge da vitrine anda junto do nome nas listas.
 *
 * Só vale para quem JÁ está na vitrine — é o que a unique parcial do banco
 * também diz, e o que impede destacar algo que ninguém está vendo.
 *
 * Apaga o destaque anterior ANTES de marcar o novo, e não numa statement só: o
 * índice `zenha_vitrine_destaque_unico_idx` é conferido a cada comando, então a
 * ordem inversa esbarraria nele mesmo dentro da transação.
 */
export async function destacar(
  playerId: number,
  inventarioId: number,
): Promise<ErroDeVitrine | null> {
  return db.transaction(async (tx) => {
    await travarVitrine(tx, playerId);

    const [linha] = await tx
      .select({ posicao: zenhaVitrine.posicao })
      .from(zenhaVitrine)
      .where(and(eq(zenhaVitrine.playerId, playerId), eq(zenhaVitrine.inventarioId, inventarioId)));
    if (!linha) return "item-nao-e-seu";

    await tx
      .update(zenhaVitrine)
      .set({ destaque: false })
      .where(and(eq(zenhaVitrine.playerId, playerId), eq(zenhaVitrine.destaque, true)));
    await tx
      .update(zenhaVitrine)
      .set({ destaque: true })
      .where(and(eq(zenhaVitrine.playerId, playerId), eq(zenhaVitrine.inventarioId, inventarioId)));

    return null;
  });
}

export type BadgeNaVitrine = {
  item: ItemDaLoja;
  posicao: number;
  destaque: boolean;
};

/** Os badges que este jogador escolheu mostrar, na ordem das vagas. */
export async function lerVitrine(exec: Executor, playerId: number): Promise<BadgeNaVitrine[]> {
  const linhas = await exec
    .select({
      posicao: zenhaVitrine.posicao,
      destaque: zenhaVitrine.destaque,
      id: lojaItens.id,
      tipo: lojaItens.tipo,
      nome: lojaItens.nome,
      descricao: lojaItens.descricao,
      preco: lojaItens.preco,
      cor: lojaItens.cor,
      imagemHash: lojaItens.imagemHash,
      ativo: lojaItens.ativo,
    })
    .from(zenhaVitrine)
    .innerJoin(zenhaInventario, eq(zenhaInventario.id, zenhaVitrine.inventarioId))
    .innerJoin(lojaItens, eq(lojaItens.id, zenhaInventario.itemId))
    .where(eq(zenhaVitrine.playerId, playerId))
    .orderBy(asc(zenhaVitrine.posicao));

  return linhas.map((l) => ({
    posicao: l.posicao,
    destaque: l.destaque,
    // Badge não tem efeito: o check `(tipo = 'consumivel') = (efeito is not
    // null)` responde por isso, e a coluna nem é lida aqui.
    item: { ...l, efeito: null },
  }));
}

/**
 * Os cosméticos que acompanham o nome de um jogador onde quer que ele apareça:
 * o badge em destaque e a cor do nome.
 *
 * São os DOIS que saem do perfil e circulam pelo app — ranking, escalação, lista
 * de presença, membros do grupo. O título ficou de fora e não é esquecimento: ele
 * é texto de largura imprevisível e empurraria a nota para fora da tela no
 * celular. Badge é imagem de 16px e cor não ocupa espaço nenhum; os dois cabem em
 * qualquer linha.
 *
 * Em LOTE, e é o ponto desta função: as telas que desenham nome desenham dezenas
 * por vez, e uma consulta por linha seria N idas ao banco para enfeitar uma
 * lista. Quem chama faz UMA chamada com todos os ids e passa o Map para baixo.
 *
 * Duas consultas em paralelo porque são duas tabelas com regras diferentes —
 * slot único em `zenha_equipados`, coleção ordenada em `zenha_vitrine` — e
 * nenhuma depende da outra.
 *
 * Item fora de venda continua pintando: quem comprou continua exibindo, que é a
 * contrapartida de o admin poder tirar do catálogo sem apagar nada. Por isso não
 * há filtro por `ativo` em nenhuma das duas.
 *
 * Lista vazia não vai ao banco: um `in ()` sem elementos é desperdício garantido.
 */
export type DestaqueDoJogador = {
  itemId: number;
  nome: string;
  imagemHash: string;
};

export type CosmeticosDoNome = {
  destaque: DestaqueDoJogador | null;
  /** A cor do slot `cor_do_nome`, em `#rrggbb`, quando há uma equipada. */
  cor: string | null;
};

export async function lerCosmeticosDoNome(
  exec: Executor,
  playerIds: readonly number[],
): Promise<Map<number, CosmeticosDoNome>> {
  if (playerIds.length === 0) return new Map();

  const ids = [...new Set(playerIds)];

  const [badges, cores] = await Promise.all([
    exec
      .select({
        playerId: zenhaVitrine.playerId,
        itemId: lojaItens.id,
        nome: lojaItens.nome,
        imagemHash: lojaItens.imagemHash,
      })
      .from(zenhaVitrine)
      .innerJoin(zenhaInventario, eq(zenhaInventario.id, zenhaVitrine.inventarioId))
      .innerJoin(lojaItens, eq(lojaItens.id, zenhaInventario.itemId))
      .where(and(eq(zenhaVitrine.destaque, true), inArray(zenhaVitrine.playerId, ids))),
    exec
      .select({ playerId: zenhaEquipados.playerId, cor: lojaItens.cor })
      .from(zenhaEquipados)
      .innerJoin(zenhaInventario, eq(zenhaInventario.id, zenhaEquipados.inventarioId))
      .innerJoin(lojaItens, eq(lojaItens.id, zenhaInventario.itemId))
      // O filtro é pelo SLOT da linha, não pelo tipo do item no catálogo: o slot
      // é a coluna da PK e é ele que garante um item por jogador. Se um item
      // mudar de tipo depois de equipado, obedecer a linha mantém a promessa —
      // obedecer o catálogo deixaria uma moldura pintar o nome.
      .where(and(eq(zenhaEquipados.slot, "cor_do_nome"), inArray(zenhaEquipados.playerId, ids))),
  ]);

  const mapa = new Map<number, CosmeticosDoNome>();
  const doJogador = (playerId: number) => {
    const atual = mapa.get(playerId);
    if (atual) return atual;
    const novo: CosmeticosDoNome = { destaque: null, cor: null };
    mapa.set(playerId, novo);
    return novo;
  };

  for (const l of badges) {
    // Só badge entra na vitrine e todo badge tem imagem (dois checks do banco
    // dizem isso). O filtro existe para o caso impossível não virar `<img src="">`
    // — que o navegador resolve como um segundo GET da própria página.
    if (l.imagemHash === null) continue;
    doJogador(l.playerId).destaque = { itemId: l.itemId, nome: l.nome, imagemHash: l.imagemHash };
  }

  for (const l of cores) {
    // Mesma defesa, do outro lado: o check `loja_itens_cor_por_tipo` garante cor
    // não-nula em item de cor, e sem isto o impossível viraria um `style` inválido.
    if (l.cor === null) continue;
    doJogador(l.playerId).cor = l.cor;
  }

  return mapa;
}
