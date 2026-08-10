import { defineConfig, devices } from "@playwright/test";
import { resolverUrlDeE2E } from "./src/test/db-url.mts";

// Smokes E2E contra o build REAL (next start) — rodar antes:
//   docker compose up -d && npx next build
// Depois: npm run e2e
//
// Sem `npm run seed` no meio: o webServer chama `npm run e2e:preparar`, que
// cria, migra e semeia o banco sozinho. E é um banco só do E2E (futzenha_e2e) —
// o seed apaga todas as tabelas, e apontá-lo para a DATABASE_URL do .env
// custava o banco de desenvolvimento a cada run.
//
// 1 worker e sem paralelismo de propósito: todos os specs batem no mesmo banco
// seedado, e specs que mudam estado (encerrar, lista de espera) não podem
// correr por cima uns dos outros.
export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    // Loga uma vez pela UI e salva o storageState — os demais specs reusam a
    // sessão sem repetir o formulário de login (menos flake, login ainda
    // coberto pelo próprio setup + o caso negativo do login.spec).
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/du.json" },
      dependencies: ["setup"],
    },
  ],
  webServer: {
    // A preparação do banco vem no MESMO comando, e não no globalSetup, porque
    // o Playwright sobe o webServer antes do globalSetup: preparando lá, o
    // `next start` subia contra um banco inexistente e só funcionava porque o
    // app tolera a falha da varredura de pendências. Aqui a ordem é garantida.
    command: "npm run e2e:preparar && npm run start",
    url: "http://localhost:3000",
    // Nunca reusar um servidor de fora. Servidor que o Playwright não subiu não
    // recebeu o `env` abaixo — ele estaria rodando contra a DATABASE_URL do
    // .env, ou seja, o BANCO DE DESENVOLVIMENTO, e os specs (que criam, encerram
    // e apagam pelada) mexeriam nele. Com `false`, porta 3000 ocupada vira erro
    // claro em vez de suíte silenciosamente apontada para o banco errado.
    reuseExistingServer: false,
    // Cobre preparar (create + migrate + seed) e o start.
    timeout: 120_000,
    // O que aponta o servidor para o banco do E2E. Basta aqui: DATABASE_URL não
    // é NEXT_PUBLIC_*, então não é embutida no build — o src/db/index.ts lê
    // process.env em runtime. E o Next não sobrescreve variável já definida no
    // processo, então este valor vence o DATABASE_URL do .env.
    //
    // O `next build` pode seguir rodando contra o banco de dev: nenhuma rota é
    // prerenderizada com dado de banco (o root layout chama getSession, que usa
    // cookies(), e isso torna toda rota abaixo dele dinâmica).
    env: { DATABASE_URL: resolverUrlDeE2E() },
  },
});
