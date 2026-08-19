import { expect, test } from "@playwright/test";
import { criarFut } from "./helpers";

// Nomes únicos por run: os specs rodam duas vezes seguidas no mesmo banco e
// cada passada precisa achar SÓ o fut que ela mesma criou.

test("cria fut com limite de vagas e a vê na listagem e no detalhe", async ({ page }) => {
  const local = `Quadra E2E com vagas ${Date.now()}`;
  const urlPublica = await criarFut(page, { local, vagas: 8 });

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

  await page.goto("/futs");
  await expect(page.getByText(local)).toBeVisible();
});

// O horário de término é o que vira o bloco na agenda de quem confirma — e o
// campo é opcional, então o smoke cobre os dois caminhos: o preenchido, que tem
// de aparecer como intervalo na página pública, e o recusado pelo teto de 6h,
// que não pode chegar ao banco.
test("horário de término aparece como intervalo e respeita o teto", async ({ page }) => {
  const local = `Quadra E2E com término ${Date.now()}`;
  const urlPublica = await criarFut(page, { local, inicio: "20:00", termino: "22:00" });

  await expect(page.getByLabel("Término")).toHaveValue("22:00");
  await page.goto(urlPublica);
  await expect(page.getByText("20:00 às 22:00")).toBeVisible();

  // Das 8h às 23h tomaria o dia inteiro de quem confirmou: o formulário recusa
  // antes de gravar, e o fut fica com o horário anterior.
  await page.goto(`${urlPublica}/gerenciar`);
  await page.getByLabel("Horário").fill("08:00");
  await page.getByLabel("Término").fill("23:00");
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByText("Dados inválidos")).toBeVisible();
  await page.goto(urlPublica);
  await expect(page.getByText("20:00 às 22:00")).toBeVisible();
});

test("cria fut sem limite (campo de vagas vazio)", async ({ page }) => {
  const local = `Quadra E2E sem limite ${Date.now()}`;
  const urlPublica = await criarFut(page, { local });

  // Sem limite não existe "de N": só a contagem de confirmados.
  await expect(page.getByText("0 confirmados", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Ver página pública" }).click();
  await expect(page).toHaveURL(urlPublica);
  await expect(page.getByText(local)).toBeVisible();
  await expect(page.getByText("Ninguém na lista ainda")).toBeVisible();
  await expect(page.getByText("vagas")).toBeHidden();
  await expect(page.getByRole("button", { name: "Vou", exact: true })).toBeVisible();

  await page.goto("/futs");
  await expect(page.getByText(local)).toBeVisible();
});
