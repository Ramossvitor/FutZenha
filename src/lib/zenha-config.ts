import "server-only";
import { eq, sql } from "drizzle-orm";
import type { Executor } from "@/db";
import { zenhaConfig } from "@/db/schema";
import { comSobrescritas, validarValorDeAjuste, type Ajustes } from "./zenha";

// As sobrescritas do admin sobre os valores da economia — a ponte entre a tabela
// `zenha_config` e os padrões puros de src/lib/zenha.ts e src/lib/loja-catalogo.ts.
//
// A tabela guarda SÓ o que foi mudado. Chave ausente vale o padrão do código, e é
// isso que dispensa migration a cada item novo do catálogo — uma tabela que
// espelhasse todos os valores nasceria desatualizada no dia do deploy.
//
// Mudar um valor vale DALI PARA FRENTE. Nada é recalculado: o que já foi pago
// está no ledger append-only, o preço pago está congelado no inventário. É essa
// ausência de reprocessamento que torna o painel do admin seguro.

/** O prefixo das chaves de preço da loja: `preco:{itemId}`. */
const PREFIXO_DE_PRECO = "preco:";

/**
 * Teto de um preço de loja. Alto de propósito — não é regra de produto, é o
 * freio contra dedo escorregado no formulário do admin (um zero a mais num
 * preço tira o item de circulação sem ninguém perceber).
 */
const PRECO_MAXIMO = 100000;

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
 * As chaves de preço não são validadas contra o catálogo — só pelo prefixo e
 * pela faixa.
 *
 * Não é preguiça: item aposentado continua no catálogo (a regra é nunca apagar
 * entrada, senão o inventário aponta para o vazio), e amarrar a ESCRITA aos ids
 * de hoje faria uma sobrescrita legítima virar erro no dia em que o catálogo
 * fosse reorganizado. Quem lê já ignora chave que não conhece — `precoVigente`
 * só consulta a chave do item que está pedindo, e `comSobrescritas` descarta
 * valor fora de faixa. O pior caso é uma linha órfã na tabela, não um preço
 * errado na loja.
 */
function validar(chave: string, valor: number): string | null {
  if (chave.startsWith(PREFIXO_DE_PRECO) && chave.length > PREFIXO_DE_PRECO.length) {
    if (!Number.isInteger(valor)) return "Use um número inteiro.";
    if (valor < 0 || valor > PRECO_MAXIMO) return `Use um número de 0 a ${PRECO_MAXIMO}.`;
    return null;
  }
  // Chave desconhecida cai aqui e sai com "Esse ajuste não existe." — a mesma
  // mensagem que o motor puro dá, para o formulário não ter dois textos.
  return validarValorDeAjuste(chave, valor);
}

/**
 * Grava (ou substitui) uma sobrescrita. Devolve a mensagem do que impediu, ou
 * `null` quando gravou.
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
  const erro = validar(chave, valor);
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
