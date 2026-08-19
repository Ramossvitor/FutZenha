import { expect, test } from "@playwright/test";

// O perfil público é a porta da parte "comunidade": tem que dar para chegar
// nele pelo nome de qualquer jogador e para mandar o link no zap. O smoke cobre
// os dois caminhos de entrada (a ponte do /perfil e um nome de ranking) e o
// ?next= do proxy, que é o que salva o link aberto por quem está deslogado.

test("do /perfil dá para abrir o próprio perfil público", async ({ page }) => {
  await page.goto("/perfil");
  await page.getByRole("link", { name: "Meu perfil público" }).click();

  await expect(page).toHaveURL(/\/jogador\/\d+$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText("Números", { exact: true })).toBeVisible();
  // A volta para a área privada só existe no próprio perfil.
  await expect(page.getByRole("link", { name: "Minha área privada" })).toBeVisible();
});

test("o nome no ranking leva ao perfil de quem é", async ({ page }) => {
  await page.goto("/rankings");

  const primeiroNome = page.locator('a[href^="/jogador/"]').first();
  await expect(primeiroNome).toBeVisible();
  // O destino do próprio link, e não o texto dele: a linha do ranking mostra o
  // apelido quando existe e o nome inteiro quando não, enquanto o h1 do perfil
  // mostra o apelido ou só o PRIMEIRO nome. Comparar os dois passava por acaso,
  // conforme quem tivesse apelido caísse no topo da tabela do seed.
  const destino = await primeiroNome.getAttribute("href");
  expect(destino).toMatch(/^\/jogador\/\d+$/);
  await primeiroNome.click();

  await expect(page).toHaveURL(new RegExp(`${destino}$`));
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test.describe("deslogado", () => {
  // O storageState do `du` pularia o login, que é justamente o que este teste
  // exercita.
  test.use({ storageState: { cookies: [], origins: [] } });

  test("o link compartilhado pede login e devolve à página certa", async ({ page }) => {
    await page.goto("/jogador/1");
    await expect(page).toHaveURL(/\/login\?next=/);

    await page.getByLabel("Usuário").fill("du");
    await page.getByLabel("Senha").fill("senha123");
    await page.getByRole("button", { name: "Entrar" }).click();

    // A asserção é o destino preservado pelo ?next=, e não o conteúdo: o seed
    // apaga as tabelas sem reiniciar as sequences, então o id 1 deixa de existir
    // depois da primeira rodada e a página vira 404 — na mesma URL.
    await expect(page).toHaveURL(/\/jogador\/1$/);
  });
});
