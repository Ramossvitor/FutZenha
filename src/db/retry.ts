/**
 * As duas decisões do funil de retentativa do ./index.ts.
 *
 * Ficam num módulo separado — e sem nenhum import — porque são a parte que
 * precisa de teste: errar aqui não dá erro na tela, dá gol, grupo ou fut
 * duplicado. Ver ./retry.test.ts.
 */

/**
 * Erros que indicam socket morto, e não query recusada.
 *
 * O cenário dominante em produção: a lambda congela entre invocações, o Neon ou
 * o NAT matam o TCP sem FIN, e no descongelamento a primeira query morre em
 * cima de um socket que só parece aberto.
 *
 * Nenhum destes garante que o servidor NÃO executou a query — o postgres.js
 * rejeita com CONNECTION_CLOSED/ECONNRESET justamente as queries já escritas no
 * socket, e a resposta pode ter se perdido DEPOIS da execução. Quem decide o
 * que pode repetir, então, é o `ehLeitura` abaixo; esta lista só separa "a
 * conexão caiu" de "o banco respondeu não".
 *
 * Erro com SQLSTATE do Postgres (`23505`, `42P01`, …) nunca entra aqui: se veio
 * um código do servidor, a conexão está viva e repetir só repetiria a recusa.
 */
const CODIGOS_DE_CONEXAO = new Set([
  "CONNECTION_CLOSED",
  "CONNECTION_ENDED",
  "CONNECTION_DESTROYED",
  "ECONNRESET",
  "EPIPE",
]);

export function ehErroDeConexao(erro: unknown): boolean {
  if (typeof erro !== "object" || erro === null || !("code" in erro)) return false;
  const code = (erro as { code: unknown }).code;
  return typeof code === "string" && CODIGOS_DE_CONEXAO.has(code);
}

/**
 * Só SELECT é retentável.
 *
 * Repetir leitura é sempre seguro, e cobre o caso real: a primeira query de
 * qualquer request é um SELECT (a sessão, no layout), que ao retentar já
 * reestabelece a conexão para o que vier depois. Escrita que topar com conexão
 * morta falha visível — o src/app/error.tsx orienta conferir antes de repetir.
 *
 * O casamento é no começo da string de propósito: `with … select` e
 * `insert … returning` ficam de fora. Um CTE pode ter `insert` dentro, e um
 * `returning` grava; nenhum dos dois vale o risco por um round-trip poupado.
 */
export function ehLeitura(sql: string): boolean {
  return /^\s*select\b/i.test(sql);
}

/** Roda, e ao topar com socket morto roda de novo — uma vez só. */
export async function comRetentativa<T>(roda: () => PromiseLike<T>): Promise<T> {
  try {
    return await roda();
  } catch (erro) {
    if (!ehErroDeConexao(erro)) throw erro;
    return roda();
  }
}
