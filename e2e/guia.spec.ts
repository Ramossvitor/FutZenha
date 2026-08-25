// O guia é a única página pública de conteúdo do app: ele existe para ser aberto
// por quem ainda não tem conta, a partir de um link mandado no grupo. Este teste
// tranca o que quebraria isso — a rota exigir login, a âncora parar debaixo da
// TopBar sticky, o guia não sair pronto no HTML (e com isso o salto de âncora
// virar corrida contra o fim do stream), e a interpolação das constantes falhar,
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

// O que este teste tranca é o STREAMING, não o CSS — do CSS cuida o de cima.
//
// O salto de âncora é do navegador, e o Chromium desiste do fragmento no fim do
// carregamento. Ele só é confiável porque /guia sai pronto no HTML: a página
// mora FORA do route group que carrega o loading.tsx, e a única leitura de banco
// dela está atrás do <Suspense> de valores-da-zenha.tsx. Quebre uma dessas duas
// coisas — mova /guia para dentro de (esqueleto), ou faça a página esperar dado
// fora daquele Suspense — e o conteúdo volta a viajar num <div hidden> revelado
// por um $RC() adiante no stream. O #a-nota então só ganha caixa de layout mais
// tarde, e o salto vira corrida.
//
// Foi assim que este teste derrubou o gate três vezes em três dias, em agosto de
// 2026. Medido no build real, com a CPU estrangulada: 13/15 a 6x quando o guia
// ainda estava sob o loading.tsx, contra 15/15 a 6x e 12/12 a 20x fora dele.
test("link direto para uma âncora funciona", async ({ page }) => {
  await page.goto("/guia#a-nota");
  await expect(page.getByRole("heading", { name: "A nota", level: 2 })).toBeInViewport();
});

// A mesma asserção de cima, sem a corrida: sem JS o $RC() nunca roda, então o
// que depender dele simplesmente não existe. É o cadeado determinístico do teste
// acima — o de cima falha às vezes, este falha sempre — e uma garantia de
// produto por si só, porque este link circula no grupo e abre em webview de app.
test.describe("sem JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("o guia sai pronto no HTML servido, e a âncora salta", async ({ page }) => {
    await page.goto("/guia#a-nota");
    await expect(
      page.getByRole("heading", { name: "A nota", level: 2 }),
      "o guia chegou por swap de stream, não no HTML inicial",
    ).toBeInViewport();
  });
});

// A tabela de valores é o único trecho de /guia que ainda chega por stream (ela
// lê o banco). O esqueleto dela precisa reservar a altura que o conteúdo real
// ocupa: "As zenhas" é o 10º de 18 capítulos, e a diferença empurra os oito de
// baixo — um link direto para #a-recarga pararia fora da tela de novo.
//
// Medir com e sem JS é o jeito determinístico de comparar os dois estados: sem
// JS o fallback fica na tela para sempre. Cronometrar o swap com JS ligado seria
// a mesma corrida que este arquivo existe para eliminar.
test("o esqueleto da tabela de valores reserva a altura do conteúdo real", async ({ browser }) => {
  const { baseURL } = test.info().project.use;

  const alturaDoCapitulo = async (javaScriptEnabled: boolean) => {
    const contexto = await browser.newContext({ baseURL, javaScriptEnabled });
    try {
      const pagina = await contexto.newPage();
      await pagina.goto("/guia");
      const secao = pagina.locator("#as-zenhas");
      await expect(secao).toBeVisible();
      // Com JS, esperar o swap: com os valores na tela não sobra pulso nenhum.
      if (javaScriptEnabled) await expect(secao.locator(".animate-pulse")).toHaveCount(0);
      return (await secao.boundingBox())!.height;
    } finally {
      await contexto.close();
    }
  };

  const comEsqueleto = await alturaDoCapitulo(false);
  const comValores = await alturaDoCapitulo(true);

  // Folga de uma linha de texto: o que importa é não deslocar capítulo, e não
  // acertar o pixel.
  expect(
    Math.abs(comEsqueleto - comValores),
    "a chegada da tabela desloca os capítulos abaixo dela",
  ).toBeLessThan(24);
});

test("os números vêm das constantes", async ({ page }) => {
  await page.goto("/guia");
  const corpo = page.locator("body");
  await expect(corpo, "prazo de avaliação sumiu do guia").toContainText("36h");
  await expect(corpo, "quórum sumiu do guia").toContainText("85%");
});
