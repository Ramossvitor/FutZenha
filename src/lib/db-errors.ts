// O drizzle embrulha o erro do driver (DrizzleQueryError → cause) — percorre a
// cadeia de cause atrás do código 23505 do Postgres.
//
// Vive aqui, e não dentro de uma action, porque distinguir "violou a unique" de
// "a conexão caiu" é o que separa uma mensagem correta de uma mentira: tratar
// todo erro do insert como duplicata esconde falha real do usuário e do log.
export function isUniqueViolation(error: unknown): boolean {
  return temCodigo(error, "23505");
}

/**
 * Violação de chave estrangeira (23503).
 *
 * Apagar um item da loja não confere antes se alguém o comprou: quem impede é o
 * `on delete restrict` de `zenha_inventario`, numa statement só e sem janela
 * para uma compra no meio. Isto é o que transforma o estouro dele na mensagem
 * certa para o admin, em vez de um 500.
 */
export function isForeignKeyViolation(error: unknown): boolean {
  return temCodigo(error, "23503");
}

function temCodigo(error: unknown, codigo: string): boolean {
  while (typeof error === "object" && error !== null) {
    if ("code" in error && error.code === codigo) return true;
    error = (error as { cause?: unknown }).cause;
  }
  return false;
}
