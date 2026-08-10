import { defineConfig, devices } from "@playwright/test";

// Smokes E2E contra o build REAL (next start) — rodar antes:
//   docker compose up -d && npm run seed && npx next build
// Depois: npm run e2e
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
    command: "npm run start",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
