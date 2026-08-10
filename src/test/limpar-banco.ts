import { getTableName, is, sql } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { db } from "@/db";
import * as schema from "@/db/schema";

// Os nomes saem do próprio schema — tabela nova entra aqui sozinha, sem lista
// para desatualizar. O narrowing usa o is() do drizzle num if, e não num
// predicado de .filter(): o schema exporta uma união de tipos concretos, e um
// predicado "is PgTable" genérico não é atribuível a ela (TS2677).
const nomes: string[] = [];
for (const valor of Object.values(schema)) {
  if (is(valor, PgTable)) nomes.push(`"${getTableName(valor)}"`);
}
const tabelas = nomes.join(", ");

/**
 * Zera TODAS as tabelas entre um teste e outro (chamado no beforeEach do
 * setup-integration). RESTART IDENTITY deixa os ids previsíveis; CASCADE cobre
 * as FKs. É a estratégia de isolamento escolhida no plano — transação-com-
 * rollback não serve porque o código sob teste abre as próprias transações e
 * locks (travarPelada faz SELECT ... FOR UPDATE).
 */
export async function limparBanco(): Promise<void> {
  await db.execute(sql.raw(`truncate table ${tabelas} restart identity cascade`));
}
