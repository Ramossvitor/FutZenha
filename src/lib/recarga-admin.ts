import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Executor } from "@/db";
import { players, zenhaPacotes, zenhaPedidos, type ZenhaPacote } from "@/db/schema";

// O lado do admin da recarga: o resumo do caixa, a lista de pedidos e o CRUD
// dos pacotes. Mora separado de src/lib/recarga.ts pela mesma razão de
// loja-admin.ts: o motor não precisa saber que um painel existe.

export type ResumoDoMes = {
  /** Soma dos pedidos pagos com `pago_em` dentro do mês corrente. */
  arrecadadoCentavos: number;
  pagos: number;
  pendentes: number;
  estornados: number;
};

/**
 * O caixa do mês corrente, pelo relógio do Postgres — o mesmo `date_trunc` da
 * escada do multiplicador, e pela mesma razão: o fuso do runtime não pode
 * decidir de que mês é um pagamento.
 *
 * Cada número tem a SUA data, e é isto que faz o caixa fechar: o dinheiro conta
 * pelo `pago_em`, o estorno pelo `estornado_em`, e só o `pendentes` (que não tem
 * desfecho ainda) conta pelo `criado_em`. Filtrar os quatro por `criado_em`
 * sumiria com o Pix criado em 31/08 e pago em 01/09 — ele não apareceria no
 * arrecadado de nenhum dos dois meses.
 *
 * Sem `where` de recorte: os filtros por data moram nos `filter` de cada
 * agregado, e um `where` amplo o bastante para servir aos quatro não recortaria
 * nada. A tabela é de um grupo de amigos comprando zenha — a varredura inteira
 * é mais barata que o índice que a evitaria.
 */
export async function resumoDoMes(exec: Executor): Promise<ResumoDoMes> {
  const mes = sql`date_trunc('month', now())`;
  const [linha] = await exec
    .select({
      arrecadadoCentavos: sql<number>`coalesce(sum(${zenhaPedidos.precoCentavos}) filter (where ${zenhaPedidos.status} = 'pago' and ${zenhaPedidos.pagoEm} >= ${mes}), 0)::int`,
      pagos: sql<number>`count(*) filter (where ${zenhaPedidos.status} = 'pago' and ${zenhaPedidos.pagoEm} >= ${mes})::int`,
      pendentes: sql<number>`count(*) filter (where ${zenhaPedidos.status} = 'pendente' and ${zenhaPedidos.criadoEm} >= ${mes})::int`,
      estornados: sql<number>`count(*) filter (where ${zenhaPedidos.status} = 'estornado' and ${zenhaPedidos.estornadoEm} >= ${mes})::int`,
    })
    .from(zenhaPedidos);
  return linha ?? { arrecadadoCentavos: 0, pagos: 0, pendentes: 0, estornados: 0 };
}

export type PedidoComJogador = {
  id: number;
  jogador: { id: number; nome: string; slug: string };
  precoCentavos: number;
  zenhas: number;
  status: (typeof zenhaPedidos.$inferSelect)["status"];
  criadoEm: Date;
  pagoEm: Date | null;
  estornadoEm: Date | null;
};

/** Os pedidos mais recentes, com quem pediu. */
export async function listarPedidosRecentes(exec: Executor, limite = 50): Promise<PedidoComJogador[]> {
  const linhas = await exec
    .select({
      id: zenhaPedidos.id,
      playerId: players.id,
      nome: players.name,
      slug: players.slug,
      precoCentavos: zenhaPedidos.precoCentavos,
      zenhas: zenhaPedidos.zenhas,
      status: zenhaPedidos.status,
      criadoEm: zenhaPedidos.criadoEm,
      pagoEm: zenhaPedidos.pagoEm,
      estornadoEm: zenhaPedidos.estornadoEm,
    })
    .from(zenhaPedidos)
    .innerJoin(players, eq(players.id, zenhaPedidos.playerId))
    .orderBy(desc(zenhaPedidos.criadoEm), desc(zenhaPedidos.id))
    .limit(limite);

  return linhas.map((l) => ({
    id: l.id,
    jogador: { id: l.playerId, nome: l.nome, slug: l.slug },
    precoCentavos: l.precoCentavos,
    zenhas: l.zenhas,
    status: l.status,
    criadoEm: l.criadoEm,
    pagoEm: l.pagoEm,
    estornadoEm: l.estornadoEm,
  }));
}

/** Todos os pacotes, ativos e retirados — o painel mostra os dois. */
export async function listarTodosPacotes(exec: Executor): Promise<ZenhaPacote[]> {
  return exec
    .select()
    .from(zenhaPacotes)
    .orderBy(desc(zenhaPacotes.ativo), sql`${zenhaPacotes.ordem} asc`, sql`${zenhaPacotes.id} asc`);
}

export type DadosDoPacote = {
  nome: string;
  precoCentavos: number;
  zenhas: number;
  ordem: number;
};

/**
 * A validação dos campos do pacote — o dono da regra, chamado pela criação e
 * pela edição. Devolve o slug do erro, ou `null`.
 *
 * As faixas repetem os checks do banco de propósito: o check é a rede, isto é a
 * resposta educada. `dados-invalidos` genérico porque o formulário tem quatro
 * campos numéricos e a tela destaca o que recusou.
 */
export function validarPacote(dados: DadosDoPacote): "dados-invalidos" | null {
  if (dados.nome.trim() === "" || dados.nome.length > 40) return "dados-invalidos";
  if (!Number.isInteger(dados.precoCentavos) || dados.precoCentavos <= 0 || dados.precoCentavos > 100000) {
    return "dados-invalidos";
  }
  if (!Number.isInteger(dados.zenhas) || dados.zenhas <= 0 || dados.zenhas > 100000) {
    return "dados-invalidos";
  }
  if (!Number.isInteger(dados.ordem) || dados.ordem < 0 || dados.ordem > 1000) return "dados-invalidos";
  return null;
}

export async function criarPacote(exec: Executor, dados: DadosDoPacote): Promise<"dados-invalidos" | null> {
  const erro = validarPacote(dados);
  if (erro !== null) return erro;
  await exec.insert(zenhaPacotes).values({ ...dados, nome: dados.nome.trim() });
  return null;
}

/**
 * Edita um pacote. Vale DALI PARA FRENTE: o que já virou pedido está congelado
 * em `zenha_pedidos` — mexer aqui nunca reprecifica um QR que já está na tela
 * de alguém.
 */
export async function salvarPacote(
  exec: Executor,
  pacoteId: number,
  dados: DadosDoPacote,
): Promise<"dados-invalidos" | "pacote-nao-encontrado" | null> {
  const erro = validarPacote(dados);
  if (erro !== null) return erro;
  const [salvo] = await exec
    .update(zenhaPacotes)
    .set({ ...dados, nome: dados.nome.trim(), atualizadoEm: sql`now()` })
    .where(eq(zenhaPacotes.id, pacoteId))
    .returning({ id: zenhaPacotes.id });
  return salvo ? null : "pacote-nao-encontrado";
}

/**
 * Tira de venda ou repõe. Não existe apagar pacote com pedido (FK `restrict`) —
 * e o painel nem oferece apagar: retirado já some da tela de recarga e os
 * pedidos antigos continuam legíveis.
 */
export async function definirPacoteAtivo(
  exec: Executor,
  pacoteId: number,
  ativo: boolean,
): Promise<"pacote-nao-encontrado" | null> {
  const [salvo] = await exec
    .update(zenhaPacotes)
    .set({ ativo, atualizadoEm: sql`now()` })
    .where(and(eq(zenhaPacotes.id, pacoteId), eq(zenhaPacotes.ativo, !ativo)))
    .returning({ id: zenhaPacotes.id });
  return salvo ? null : "pacote-nao-encontrado";
}
