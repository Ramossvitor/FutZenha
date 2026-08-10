// globalSetup do projeto "integration" (roda UMA vez, em processo separado dos
// testes): garante que o banco de teste existe e está migrado.

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { resolverUrlDeTeste } from "./db-url.mts";

export default async function setup(): Promise<void> {
  const url = resolverUrlDeTeste();
  const nomeDoBanco = new URL(url).pathname.slice(1);

  // Cria o banco de teste se não existir, conectando no banco "postgres" do
  // mesmo servidor (sempre existe na imagem oficial; o usuário do compose é
  // superuser). CREATE DATABASE não roda dentro de transação — max: 1 e sem
  // begin.
  const urlAdmin = new URL(url);
  urlAdmin.pathname = "/postgres";
  const admin = postgres(urlAdmin.toString(), { max: 1, onnotice: () => {} });
  try {
    const [existe] = await admin`select 1 from pg_database where datname = ${nomeDoBanco}`;
    if (!existe) await admin.unsafe(`create database "${nomeDoBanco}"`);
  } finally {
    await admin.end();
  }

  // Migrations pelo runner do drizzle, que respeita os statement-breakpoints —
  // obrigatório: a 0012 usa ALTER TYPE ... ADD VALUE, que o Postgres proíbe na
  // mesma transação que o criou. Nunca trocar por SQL concatenado num BEGIN só.
  // Sem o provisionamento de admins do src/db/migrate.ts: aqui só o schema.
  const conn = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  try {
    await migrate(drizzle(conn), { migrationsFolder: "./drizzle" });
  } finally {
    await conn.end();
  }
}
