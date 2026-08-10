import { expect, test } from "@playwright/test";
import { criarPelada } from "./helpers";

// Nomes únicos por run: os specs rodam duas vezes seguidas no mesmo banco e
// cada passada precisa achar SÓ a pelada que ela mesma criou.

test("cria pelada com limite de vagas e a vê na listagem e no detalhe", async ({ page }) => {
  const local = `Quadra E2E com vagas ${Date.now()}`;
  const urlPublica = await criarPelada(page, { local, vagas: 8 });

  // No painel de gestão o limite aparece no contador de presença.
  await expect(page.getByLabel("Local")).toHaveValue(local);
  await expect(page.getByText("0 confirmados de 8")).toBeVisible();

  // Detalhe público: local no cabeçalho e o placar de vagas.
  await page.getByRole("link", { name: "Ver página pública" }).click();
  await expect(page).toHaveURL(urlPublica);
  await expect(page.getByText(local)).toBeVisible();
  await expect(page.getByText("/ 8 vagas")).toBeVisible();
  // Com 0/8 a lista não está cheia — o CTA é "Vou", não "Entrar na espera".
  await expect(page.getByRole("button", { name: "Vou", exact: true })).toBeVisible();

  await page.goto("/peladas");
  await expect(page.getByText(local)).toBeVisible();
});

test("cria pelada sem limite (campo de vagas vazio)", async ({ page }) => {
  const local = `Quadra E2E sem limite ${Date.now()}`;
  const urlPublica = await criarPelada(page, { local });

  // Sem limite não existe "de N": só a contagem de confirmados.
  await expect(page.getByText("0 confirmados", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Ver página pública" }).click();
  await expect(page).toHaveURL(urlPublica);
  await expect(page.getByText(local)).toBeVisible();
  await expect(page.getByText("Ninguém na lista ainda")).toBeVisible();
  await expect(page.getByText("vagas")).toBeHidden();
  await expect(page.getByRole("button", { name: "Vou", exact: true })).toBeVisible();

  await page.goto("/peladas");
  await expect(page.getByText(local)).toBeVisible();
});
