// O drizzle embrulha o erro do driver (DrizzleQueryError → cause) — percorre a
// cadeia de cause atrás do código 23505 do Postgres.
//
// Vive aqui, e não dentro de uma action, porque distinguir "violou a unique" de
// "a conexão caiu" é o que separa uma mensagem correta de uma mentira: tratar
// todo erro do insert como duplicata esconde falha real do usuário e do log.
export function isUniqueViolation(error: unknown): boolean {
  while (typeof error === "object" && error !== null) {
    if ("code" in error && error.code === "23505") return true;
    error = (error as { cause?: unknown }).cause;
  }
  return false;
}
