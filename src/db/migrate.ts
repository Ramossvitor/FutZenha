import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import {
  materializarPlatformAdmins,
  provisionarPlatformAdmins,
} from "./platform-admins-bootstrap";

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

  // O aviso precisa ser barulhento, não fatal: derrubar o build por causa de
  // uma env var que a integração antiga não injeta deixaria produção sem
  // deploy — e DDL transacional simples ainda passa pelo PgBouncer.
  if (process.env.VERCEL && url === process.env.DATABASE_URL) {
    console.warn(
      "[migrate] ATENÇÃO: usando a connection string POOLED (PgBouncer) para migrations. " +
        "Configure DIRECT_DATABASE_URL (ou atualize a integração Neon) — " +
        "CREATE INDEX CONCURRENTLY e afins vão falhar por aqui.",
    );
  }

  // onnotice silencia os "already exists, skipping" que o migrator provoca em
  // toda execução — o log do build fica legível.
  const conn = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  try {
    await migrate(drizzle(conn), { migrationsFolder: "./drizzle" });
    console.log("[migrate] Migrations aplicadas.");
    await provisionarPlatformAdmins(conn);
    await materializarPlatformAdmins(conn);
  } finally {
    await conn.end();
  }
}

// Fut anterior a este modelo fica órfão mesmo — não há backfill de dono.
//
// Houve aqui um passo que atribuía as órfãs ao primeiro admin da plataforma,
// gateado por "nenhum fut tem criador". O gate não era one-shot de verdade:
// bastava sobrarem só órfãs (todas as com dono apagadas) para o build seguinte
// redistribuir tudo de novo — e este arquivo roda a cada `npm run build`, fora
// do journal do drizzle. O passo também não era necessário: o admin da
// plataforma já administra fut órfão por regra (ver podeGerenciarFut em
// src/lib/permissions.ts), e /admin/futs rotula e conta os órfãos. Dono
// inventado só apagaria essa informação.

main().catch((error) => {
  console.error("[migrate] Falha ao aplicar migrations:", error);
  process.exit(1);
});
