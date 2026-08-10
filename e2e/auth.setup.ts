import path from "node:path";
import { expect, test as setup } from "@playwright/test";
import { loginPelaUI } from "./helpers";

// Loga uma vez pela UI como `du` (admin da plataforma e das peladas do seed) e
// guarda o storageState que o projeto "chromium" injeta em todos os specs.
const arquivoDeSessao = path.join(__dirname, ".auth", "du.json");

setup("loga como du e guarda a sessão", async ({ page }) => {
  await loginPelaUI(page, "du");
  await expect(page).toHaveURL("/");
  await page.context().storageState({ path: arquivoDeSessao });
});
