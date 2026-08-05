import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    "DATABASE_URL não definida. Local: copie .env.example para .env e rode `docker compose up -d`. " +
      "Produção: conecte o banco Neon ao projeto na Vercel (Storage → Connect Database).",
  );
}

// Reusa a conexão entre hot-reloads em dev para não esgotar o pool.
const globalForDb = globalThis as unknown as { conn?: ReturnType<typeof postgres> };

const conn =
  globalForDb.conn ??
  postgres(url, {
    // A string pooled do Neon passa por PgBouncer em transaction mode, que não
    // suporta prepared statements. Sem isto, toda query falha em produção.
    prepare: false,
    // Uma conexão por instância serverless — várias lambdas frias somam rápido.
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
  });
if (process.env.NODE_ENV !== "production") globalForDb.conn = conn;

export const db = drizzle(conn, { schema });
