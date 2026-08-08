import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // Mesma cascata do src/db/migrate.ts: DDL e studio pedem a conexão DIRETA;
    // a pooled (PgBouncer) só entra como último recurso — que é o caso local,
    // onde o docker já é conexão direta.
    url:
      process.env.DIRECT_DATABASE_URL ??
      process.env.DATABASE_URL_UNPOOLED ??
      process.env.POSTGRES_URL_NON_POOLING ??
      process.env.DATABASE_URL!,
  },
});
