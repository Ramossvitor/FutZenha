import { expect, test } from "@playwright/test";
import { loginPelaUI } from "./helpers";

// Contexto limpo de propósito: o storageState do `du` esconderia o formulário
// (logado, /login redireciona para a home).
test.use({ storageState: { cookies: [], origins: [] } });

test("senha errada mostra o erro genérico e não loga", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Usuário").fill("du");
  await page.getByLabel("Senha").fill("senha-errada");
  await page.getByRole("button", { name: "Entrar" }).click();

  // O erro é genérico por design (não entrega quais usuários existem).
  await expect(page.getByText("Usuário ou senha incorretos.")).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("button", { name: "Sair" })).toBeHidden();
});

test("login correto aterrissa logado na home", async ({ page }) => {
  await loginPelaUI(page, "du");
  await expect(page).toHaveURL("/");
});
