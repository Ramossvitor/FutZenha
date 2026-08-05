import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

// Roda antes do `next build` (ver package.json). Migrations viajam junto com o
// código: um `git push` na main aplica o schema novo e publica.

// Migrations precisam da connection string DIRETA — a pooled passa por
// PgBouncer, que não serve para DDL em sessão. As duas do meio são injetadas
// pela integração Neon da Vercel; DIRECT_DATABASE_URL é a válvula manual.
function resolveUrl(): string | undefined {
  return (
    process.env.DIRECT_DATABASE_URL ??
    process.env.DATABASE_URL_UNPOOLED ??
    process.env.POSTGRES_URL_NON_POOLING ??
    process.env.DATABASE_URL
  );
}

async function main() {
  const vercelEnv = process.env.VERCEL_ENV;
  if (vercelEnv && vercelEnv !== "production") {
    console.log(`[migrate] VERCEL_ENV=${vercelEnv} — pulando (só produção migra o banco).`);
    return;
  }

  const url = resolveUrl();
  if (!url) {
    if (process.env.VERCEL) {
      console.error(
        "[migrate] Nenhuma connection string encontrada. Conecte o banco Neon ao projeto " +
          "na Vercel (Storage → Connect Database) e refaça o deploy.",
      );
      process.exit(1);
    }
    console.warn("[migrate] Sem DATABASE_URL — pulando migrations (build local).");
    return;
  }

  // onnotice silencia os "already exists, skipping" que o migrator provoca em
  // toda execução — o log do build fica legível.
  const conn = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  try {
    await migrate(drizzle(conn), { migrationsFolder: "./drizzle" });
    console.log("[migrate] Migrations aplicadas.");
  } finally {
    await conn.end();
  }
}

main().catch((error) => {
  console.error("[migrate] Falha ao aplicar migrations:", error);
  process.exit(1);
});
