import "dotenv/config";
import { execFileSync } from "node:child_process";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { resolverUrlDeE2E } from "../test/db-url.mts";

// Deixa o banco do E2E pronto: existente, migrado e semeado.
//
// Roda como PRIMEIRO passo do comando do webServer (ver playwright.config.ts), e
// não no globalSetup do Playwright, porque o webServer sobe antes dele — com a
// preparação no globalSetup, o `next start` ia ao ar contra um banco que ainda
// não existia e o app cuspia "database futzenha_e2e does not exist" até o setup
// alcançar. Funcionava por tolerância do app, não por garantia.
//
// Idempotente: pode rodar sozinho (`npm run e2e:preparar`) quantas vezes quiser.

async function main() {
  const url = resolverUrlDeE2E();
  const nomeDoBanco = new URL(url).pathname.slice(1);

  // Banco PRÓPRIO, nunca o da DATABASE_URL do .env: o seed lá embaixo apaga
  // todas as tabelas, e antes disto rodar o E2E local custava o banco de
  // desenvolvimento. As duas travas moram no resolverUrlDeE2E.
  //
  // Mesmo caminho do src/test/global-setup.ts: conecta no banco "postgres" do
  // mesmo servidor (sempre existe na imagem oficial; o usuário do compose é
  // superuser). CREATE DATABASE não roda dentro de transação — max: 1, sem begin.
  const urlAdmin = new URL(url);
  urlAdmin.pathname = "/postgres";
  const admin = postgres(urlAdmin.toString(), { max: 1, onnotice: () => {} });
  try {
    const [existe] = await admin`select 1 from pg_database where datname = ${nomeDoBanco}`;
    if (!existe) {
      await admin.unsafe(`create database "${nomeDoBanco}"`);
      console.log(`[e2e] Banco "${nomeDoBanco}" criado.`);
    }
  } finally {
    await admin.end();
  }

  // Migrations pelo runner do drizzle, que respeita os statement-breakpoints —
  // obrigatório: a 0012 usa ALTER TYPE ... ADD VALUE, que o Postgres proíbe na
  // mesma transação que o criou. Nunca trocar por SQL concatenado num BEGIN só.
  const conn = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  try {
    await migrate(drizzle(conn), { migrationsFolder: "./drizzle" });
  } finally {
    await conn.end();
  }

  // Subprocesso, e não um semear() exportado: manter o seed como script deixa
  // intacta a trava que o impede de rodar fora de localhost. O `import
  // "dotenv/config"` do topo dele NÃO sobrescreve variável já presente no
  // ambiente, então a DATABASE_URL injetada aqui vence a do .env.
  //
  // process.execPath + `--import tsx` em vez de npx: dispensa o shim .cmd do
  // Windows e não depende de resolução de PATH.
  execFileSync(process.execPath, ["--import", "tsx", "src/db/seed.ts"], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "inherit",
  });
}

main().catch((error) => {
  console.error("[e2e] Falha ao preparar o banco:", error);
  process.exit(1);
});
