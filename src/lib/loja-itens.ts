import "server-only";
import { eq, sql } from "drizzle-orm";
import type { Executor } from "@/db";
import { lojaImagens, lojaItens, zenhaInventario } from "@/db/schema";
import {
  EFEITO_DO_MULTIPLICADOR,
  ordenarParaVitrine,
  type EfeitoDeItem,
  type ItemDaLoja,
} from "./item-da-loja";

// A leitura do catálogo. Só isto: quem compra é src/lib/loja.ts, quem
// administra é src/lib/loja-admin.ts, e quem sabe DESENHAR um item é o módulo
// puro src/lib/item-da-loja.ts.
//
// ── A projeção explícita não é estilo ───────────────────────────────────────
//
// Nenhuma função daqui usa `select()` sem argumento, e `loja_imagens` só é
// tocada por `lerImagemDoItem`. Os bytes de um badge são até 200 KB, e as
// consultas desta camada rodam na vitrine, no perfil e em toda linha de
// ranking: um `select()` distraído carregaria a arte inteira de cada item para
// desenhar um `<img>`, e o TOAST do Postgres esconde tão bem esse custo que
// ninguém perceberia antes da conta do Neon.

const SELECAO_DO_ITEM = {
  id: lojaItens.id,
  tipo: lojaItens.tipo,
  nome: lojaItens.nome,
  descricao: lojaItens.descricao,
  preco: lojaItens.preco,
  cor: lojaItens.cor,
  imagemHash: lojaItens.imagemHash,
  efeito: lojaItens.efeito,
  ativo: lojaItens.ativo,
};

type LinhaDoItem = Omit<ItemDaLoja, "efeito"> & { efeito: string | null };

/**
 * O efeito lido do banco, estreitado para o que o código implementa.
 *
 * O `check (efeito is null or efeito in ('multiplicador'))` garante que o outro
 * ramo não acontece com dado real. Ele existe para o dia em que uma migration
 * acrescentar um efeito ANTES de o motor dele existir: o item degrada para
 * "consumível que não faz nada" em vez de o `as` mentir para o resto do app.
 */
function efeitoConhecido(valor: string | null): EfeitoDeItem | null {
  return valor === EFEITO_DO_MULTIPLICADOR ? EFEITO_DO_MULTIPLICADOR : null;
}

function paraItem(linha: LinhaDoItem): ItemDaLoja {
  return { ...linha, efeito: efeitoConhecido(linha.efeito) };
}

/**
 * O que está à venda, na ordem da vitrine.
 *
 * A ordenação é em JavaScript e não em `ORDER BY` porque a ordem das
 * prateleiras é decisão de PRODUTO (o consumível abre a loja), e ela mora no
 * módulo puro junto com o resto das regras de desenho. Reescrevê-la em SQL
 * seria a segunda implementação da mesma lista — e as duas divergiriam no dia em
 * que um tipo novo entrasse. O índice `(ativo, tipo, preco)` continua servindo ao
 * filtro, que é o caro.
 */
export async function lerItensAVenda(exec: Executor): Promise<ItemDaLoja[]> {
  const linhas = await exec.select(SELECAO_DO_ITEM).from(lojaItens).where(eq(lojaItens.ativo, true));
  return ordenarParaVitrine(linhas.map(paraItem));
}

/** Um item da loja, à venda ou não. `undefined` = não existe. */
export async function lerItem(exec: Executor, id: number): Promise<ItemDaLoja | undefined> {
  const [linha] = await exec.select(SELECAO_DO_ITEM).from(lojaItens).where(eq(lojaItens.id, id));
  return linha && paraItem(linha);
}

export type ItemComVendas = ItemDaLoja & {
  /** Quantas vezes este item foi comprado. É o que decide se dá para apagá-lo. */
  vendas: number;
};

/**
 * O catálogo inteiro para o painel do admin, com quantas vendas cada item teve.
 *
 * A contagem vem junto, e não numa segunda consulta por item, porque é ela que
 * decide qual botão a linha mostra: item nunca comprado pode ser apagado, item
 * vendido só pode ser retirado de venda. Uma contagem por linha na tela seria N
 * consultas para desenhar uma lista.
 *
 * `group by` pelo id — que é PK, e o Postgres aceita as demais colunas da mesma
 * tabela por dependência funcional.
 */
export async function lerTodosOsItens(exec: Executor): Promise<ItemComVendas[]> {
  const linhas = await exec
    .select({ ...SELECAO_DO_ITEM, vendas: sql<number>`count(${zenhaInventario.id})::int` })
    .from(lojaItens)
    .leftJoin(zenhaInventario, eq(zenhaInventario.itemId, lojaItens.id))
    .groupBy(lojaItens.id);
  return ordenarParaVitrine(linhas.map((l) => ({ ...paraItem(l), vendas: l.vendas })));
}

/**
 * Os bytes da imagem, se o hash pedido for o que está guardado.
 *
 * O hash entra no `where` de propósito: a URL é imutável e cacheada por um ano,
 * então pedir a arte ANTIGA de um item precisa dar 404 — e não a arte nova com
 * a URL velha, que é como um badge trocado apareceria errado para quem tem a
 * página aberta. É a mesma consulta que decide o `Content-Type` da resposta.
 */
export async function lerImagemDoItem(
  exec: Executor,
  itemId: number,
  hash: string,
): Promise<{ mime: string; bytes: Buffer } | undefined> {
  const [linha] = await exec
    .select({ mime: lojaImagens.mime, bytes: lojaImagens.bytes })
    .from(lojaImagens)
    .where(sql`${lojaImagens.itemId} = ${itemId} and ${lojaImagens.hash} = ${hash}`);
  return linha;
}
