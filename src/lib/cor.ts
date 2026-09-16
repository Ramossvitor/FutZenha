// Cor livre, como o app inteiro a guarda: `#rrggbb` minúsculo, e nada mais.
//
// Mora num módulo próprio porque agora são dois donos de coluna — a cor dos
// cosméticos (`loja_itens.cor`) e a dos coletes (`teams.cor`,
// `coletes_do_grupo.cor`) — e os três `check` do banco cobram exatamente este
// formato. Puro: sem drizzle, sem `server-only`, para valer no zod da action e
// no componente que desenha.

/** Formato de cor aceito. Minúsculas: a normalização é da escrita, não da leitura. */
export const REGEX_DE_COR = /^#[0-9a-f]{6}$/;

/**
 * O valor de um `<input type="color">` (ou de um rádio com hex) pronto para o
 * banco, ou null quando não é cor nenhuma. Minúsculas na entrada, porque o
 * browser devolve o hex como bem entende e o `check` só aceita minúsculo.
 */
export function normalizarCor(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const cor = valor.trim().toLowerCase();
  return REGEX_DE_COR.test(cor) ? cor : null;
}
