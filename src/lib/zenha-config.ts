import "server-only";
import { eq, sql } from "drizzle-orm";
import type { Executor } from "@/db";
import { zenhaConfig } from "@/db/schema";
import { comSobrescritas, validarValorDeAjuste, type Ajustes } from "./zenha";

// As sobrescritas do admin sobre os valores da economia — a ponte entre a tabela
// `zenha_config` e os padrões puros de src/lib/zenha.ts.
//
// A tabela guarda SÓ o que foi mudado. Chave ausente vale o padrão do código, e
// é isso que faz um ajuste novo em zenha.ts já nascer valendo, sem migration.
//
// Mudar um valor vale DALI PARA FRENTE. Nada é recalculado: o que já foi pago
// está no ledger append-only, o preço pago está congelado no inventário. É essa
// ausência de reprocessamento que torna o painel do admin seguro.
//
// PREÇO DE ITEM não passa por aqui, e já passou: havia um espaço de chaves
// `preco:{itemId}` porque o catálogo era código e não existia coluna onde
// guardar o número. Agora existe (`loja_itens.preco`), e a chave morreu junto
// com a migration 0033 — duas portas para o mesmo preço seriam duas verdades.

export async function lerSobrescritas(exec: Executor): Promise<Map<string, number>> {
  const linhas = await exec
    .select({ chave: zenhaConfig.chave, valor: zenhaConfig.valor })
    .from(zenhaConfig);
  return new Map(linhas.map((l) => [l.chave, l.valor]));
}

/** Os valores vigentes dos AJUSTES: os padrões de zenha.ts com as sobrescritas por cima. */
export async function getAjustes(exec: Executor): Promise<Ajustes> {
  return comSobrescritas(await lerSobrescritas(exec));
}

/**
 * Grava (ou substitui) uma sobrescrita. Devolve a mensagem do que impediu, ou
 * `null` quando gravou.
 *
 * A validação é a do motor puro e SÓ ela: chave que não é ajuste sai com "Esse
 * ajuste não existe.", inclusive as `preco:*` que um formulário antigo ou uma
 * aba velha ainda mandem. Este módulo é o dono da regra — a action apenas
 * repassa o que veio do formulário.
 *
 * Texto em vez de exceção porque quem chama é uma Server Action, e o caminho
 * normal dela é mostrar o problema no campo — não estourar. Valor recusado NÃO
 * toca a tabela: o admin continua com o que estava valendo.
 */
export async function salvarAjuste(
  exec: Executor,
  chave: string,
  valor: number,
  porPlayerId: number,
): Promise<string | null> {
  const erro = validarValorDeAjuste(chave, valor);
  if (erro !== null) return erro;

  await exec
    .insert(zenhaConfig)
    .values({ chave, valor, atualizadoPorPlayerId: porPlayerId })
    .onConflictDoUpdate({
      target: zenhaConfig.chave,
      // `now()` do Postgres, nunca `new Date()` em sql cru — é a regra do driver.
      set: { valor, atualizadoEm: sql`now()`, atualizadoPorPlayerId: porPlayerId },
    });
  return null;
}

/**
 * Apaga a sobrescrita — ou seja, volta ao padrão do código.
 *
 * Não existe "gravar o padrão": a linha ausente É o padrão, e é o que faz o
 * valor acompanhar sozinho uma mudança futura em zenha.ts. Gravar o número de
 * hoje congelaria o de hoje.
 */
export async function limparAjuste(exec: Executor, chave: string): Promise<void> {
  await exec.delete(zenhaConfig).where(eq(zenhaConfig.chave, chave));
}
