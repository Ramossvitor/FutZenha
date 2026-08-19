// O guia é a única página pública de conteúdo do app: ele existe para ser aberto
// por quem ainda não tem conta, a partir de um link mandado no grupo. Este teste
// tranca as três coisas que quebrariam isso — a rota exigir login, a âncora
// parar debaixo da TopBar sticky, e a interpolação das constantes falhar,
// deixando o guia sem os números que ele existe para explicar.
import { expect, test } from "@playwright/test";

test.use({ storageState: { cookies: [], origins: [] } });

test("abre deslogado", async ({ page }) => {
  await page.goto("/guia");
  await expect(
    page.getByRole("heading", { name: "Guia do FutZenha", level: 1 }),
    "o guia precisa abrir sem sessão",
  ).toBeVisible();
});

test("o índice salta para o capítulo, sem esconder o título", async ({ page }) => {
  // Viewport de celular de propósito. A TopBar é `lg:hidden`: no 1280px padrão
  // do projeto ela nem existe, e o teste passaria com ou sem o `scroll-mt` da
  // página — que é exatamente a regressão que ele existe para pegar.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/guia");
  await page.getByRole("link", { name: /A nota/ }).first().click();

  const titulo = page.getByRole("heading", { name: "A nota", level: 2 });
  await expect(titulo, "o capítulo precisa estar visível").toBeVisible();

  // Contra a altura REAL da TopBar, e não contra zero: sem o `scroll-mt` o topo
  // da <section> para em y=0 e o <h2>, que vem depois do Eyebrow, ainda teria
  // y > 0 — o teste passava justamente no caso que devia falhar.
  const topBar = page.getByRole("banner");
  const caixaDaTopBar = await topBar.boundingBox();
  const caixa = await titulo.boundingBox();
  expect(caixa!.y, "o título parou debaixo da TopBar sticky").toBeGreaterThanOrEqual(
    caixaDaTopBar!.y + caixaDaTopBar!.height,
  );
});

test("link direto para uma âncora funciona", async ({ page }) => {
  await page.goto("/guia#a-nota");
  await expect(page.getByRole("heading", { name: "A nota", level: 2 })).toBeInViewport();
});

test("os números vêm das constantes", async ({ page }) => {
  await page.goto("/guia");
  const corpo = page.locator("body");
  await expect(corpo, "prazo de avaliação sumiu do guia").toContainText("36h");
  await expect(corpo, "quórum sumiu do guia").toContainText("85%");
});
