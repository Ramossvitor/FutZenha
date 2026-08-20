// O link do fut, de ponta a ponta.
//
// Os três caminhos de entrada têm cobertura de integração farta
// (src/app/fut/[id]/entrada-actions.integration.test.ts, 21 casos); o que só o
// E2E alcança é o que fica FORA das actions: a rota nova existir, o proxy
// montar o `?next=` para quem chega deslogado pelo WhatsApp, e a página do
// convite renderizar contra o build de verdade.

import { expect, test } from "@playwright/test";
import { criarFut } from "./helpers";

/** Cria um fut e devolve o link de convite gerado no painel. */
async function gerarLinkDoFut(page: import("@playwright/test").Page): Promise<string> {
  const local = `Quadra E2E entrada ${Date.now()}`;
  await criarFut(page, { local });

  await page.getByRole("button", { name: "Gerar link" }).click();
  const codigo = page.locator("code", { hasText: "/convite-fut/" });
  await expect(codigo).toBeVisible();
  return (await codigo.innerText()).trim();
}

test("quem organiza gera o link do fut e a página do convite abre", async ({ page }) => {
  const url = await gerarLinkDoFut(page);
  expect(url).toContain("/convite-fut/");

  await page.goto(url);
  // Quem já organiza o fut não está na lista até confirmar, então a tela
  // oferece a confirmação — é o mesmo botão que qualquer convidado vê.
  await expect(page.getByRole("button", { name: "Confirmar presença" })).toBeVisible();
});

test("revogar o link derruba o convite", async ({ page }) => {
  const url = await gerarLinkDoFut(page);

  await page.getByRole("button", { name: "Revogar" }).click();
  await expect(page.getByRole("button", { name: "Gerar link" })).toBeVisible();

  await page.goto(url);
  // `getByRole("heading")`, e não `getByText`: o route announcer do Next repete
  // o título da página num <div role="alert">, e o texto casaria os dois — uma
  // violação de strict mode que só aparece às vezes, porque o announcer é
  // transitório.
  await expect(
    page.getByRole("heading", { name: "Convite inválido ou expirado" }),
  ).toBeVisible();
});

test.describe("deslogado", () => {
  // O storageState do `du` pularia o login, que é justamente o que este teste
  // exercita: o link do fut corre no WhatsApp e quase sempre é aberto por quem
  // não está logado.
  test.use({ storageState: { cookies: [], origins: [] } });

  test("o link do fut pede login e devolve à página do convite", async ({ page }) => {
    await page.goto("/convite-fut/token-que-nao-existe");

    await expect(page).toHaveURL(/\/login\?next=%2Fconvite-fut%2F/);

    await page.getByLabel("Usuário").fill("du");
    await page.getByLabel("Senha").fill("senha123");
    await page.getByRole("button", { name: "Entrar" }).click();

    // O destino preservado pelo ?next= é o que este teste prova. O token é
    // inválido de propósito — a asserção é sobre o caminho de volta, e um token
    // real não sobreviveria entre as duas passadas do spec no mesmo banco.
    await expect(page).toHaveURL(/\/convite-fut\/token-que-nao-existe$/);
    await expect(
      page.getByRole("heading", { name: "Convite inválido ou expirado" }),
    ).toBeVisible();
  });
});
