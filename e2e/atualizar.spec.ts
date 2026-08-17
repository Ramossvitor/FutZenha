import { devices, expect, test, type Page } from "@playwright/test";
import { arrastarComODedo } from "./helpers";

// Puxar-para-atualizar no celular, botão na lateral no desktop. O que estes
// smokes trancam não é o visual: são as três guardas que impedem o gesto de
// roubar toques que não são dele (rolagem já iniciada, deslize lateral sobre a
// faixa de abas, e a espera pós-atualização), mais a promessa de que nenhum dos
// dois disparos navega para outro lugar.
//
// No arquivo inteiro, e não num describe: o perfil do device traz um
// `defaultBrowserType`, e o Playwright recusa isso dentro de grupo. O caso do
// desktop, no fim, muda só a largura na mão — é o que a media query olha.
test.use({ ...devices["Pixel 5"] });

const PILULA = "[data-puxada]";

/**
 * Espera a página estar de pé o bastante para receber o disparo.
 *
 * `page.goto` resolve no load do DOCUMENTO, e as duas coisas de que o disparo
 * depende chegam depois dele. Sem esta espera o spec ficava verde no /rankings e
 * vermelho na home — e não por lentidão, mas porque a home tem conteúdo suficiente
 * para o esqueleto do loading.tsx ainda estar na tela no instante do toque. Aqui
 * dentro do spec, e não no helpers.ts: o sinal é interno ao puxar-para-atualizar,
 * e helper compartilhado se anunciaria como espera genérica sendo de uma feature.
 */
async function esperarOGesto(page: Page, sinal: "contain" | "auto" = "contain"): Promise<void> {
  // 1. O conteúdo de verdade no lugar do PageSkeleton. Arrastar em cima do
  //    esqueleto não engatava o gesto — foi esta a causa do vermelho na home.
  await expect(page.getByRole("status", { name: "Carregando" })).toHaveCount(0);

  // 2. Os handlers instalados. A pílula (e o botão da lateral) vêm no HTML do
  //    servidor, então esperar por eles não prova nada; o sinal é o
  //    `overscroll-behavior-y` que o próprio efeito escreve na raiz ao montar —
  //    "contain" no celular, "auto" (inerte) no desktop. Já faz parte do
  //    recurso, então não há atributo só-para-teste pendurado no componente.
  await expect
    .poll(() => page.evaluate(() => document.documentElement.style.overscrollBehaviorY), {
      message: "puxar-para-atualizar hidratado",
    })
    .toBe(sinal);
}

test.describe("celular", () => {
  test("puxar do topo atualiza sem sair da página", async ({ page }) => {
    await page.goto("/rankings?aba=artilharia");
    await esperarOGesto(page);
    const pilula = page.locator(PILULA);
    await expect(pilula).toHaveAttribute("data-puxada", "parado");

    // 200px de dedo: bem acima dos ~93px que a curva de resistência exige.
    await arrastarComODedo(page, { x: 180, y: 140 }, { x: 180, y: 340 });

    await expect(pilula).toHaveAttribute("data-puxada", "concluido");
    await expect(pilula).toContainText("Atualizado");
    // A query string precisa sobreviver — é o que separa `router.refresh()` de
    // uma navegação para a rota nua.
    await expect(page).toHaveURL(/\/rankings\?aba=artilharia$/);
  });

  test("a espera segura a segunda puxada logo depois da primeira", async ({ page }) => {
    await page.goto("/");
    await esperarOGesto(page);
    const pilula = page.locator(PILULA);

    await arrastarComODedo(page, { x: 180, y: 140 }, { x: 180, y: 340 });
    await expect(pilula).toHaveAttribute("data-puxada", "concluido");

    // Ainda dentro dos 5s: o gesto não pode nem engatar, então a pílula
    // continua dizendo "concluido" em vez de voltar para "atualizando".
    // Leitura única, SEM retry: com a trava quebrada a pílula mostraria
    // "atualizando" já no soltar e voltaria a "concluido" logo depois — um
    // assert com retry esperaria essa volta e passaria com a regressão.
    await arrastarComODedo(page, { x: 180, y: 140 }, { x: 180, y: 340 });
    expect(
      await pilula.getAttribute("data-puxada"),
      "o gesto não pode engatar durante a espera",
    ).toBe("concluido");
  });

  test("deslizar na faixa de abas dos rankings não dispara", async ({ page }) => {
    // A regressão concreta: a faixa é `overflow-x-auto`, e sem a guarda de eixo
    // trocar de aba com o dedo viraria uma atualização a cada deslize.
    await page.goto("/rankings");
    await esperarOGesto(page);
    const abas = page.getByRole("navigation", { name: "Rankings" });
    const caixa = await abas.boundingBox();
    expect(caixa, "faixa de abas dos rankings").toBeTruthy();

    const meio = caixa!.y + caixa!.height / 2;
    // Com 24px de queda no fim: o dedo real treme, e um arrasto perfeitamente
    // horizontal teria dy=0 — que deixa a pílula em "parado" até com a guarda
    // de eixo removida (resistencia(0) é 0). Lateral segue dominante, então a
    // guarda tem de recusar; quebrada, agora produziria fase visível.
    await arrastarComODedo(
      page,
      { x: caixa!.x + caixa!.width - 12, y: meio },
      { x: caixa!.x + 12, y: meio + 24 },
    );

    await expect(page.locator(PILULA)).toHaveAttribute("data-puxada", "parado");
  });

  test("puxar com a página já rolada não dispara, e volta a disparar no topo", async ({ page }) => {
    // Tela baixa de propósito: /rankings com o seed cabe inteira num Pixel 5, e
    // um teste de rolagem numa página que não rola passaria sem testar nada.
    await page.setViewportSize({ width: 393, height: 400 });
    await page.goto("/rankings");
    await esperarOGesto(page);
    const pilula = page.locator(PILULA);

    await page.evaluate(() => window.scrollTo(0, 300));
    expect(await page.evaluate(() => window.scrollY), "rolagem de partida").toBeGreaterThan(0);
    await arrastarComODedo(page, { x: 180, y: 120 }, { x: 180, y: 320 });
    await expect(pilula).toHaveAttribute("data-puxada", "parado");

    // O contrapeso: sem ele, um bug que desligasse o gesto por inteiro passaria
    // no assert de cima.
    await page.evaluate(() => window.scrollTo(0, 0));
    await arrastarComODedo(page, { x: 180, y: 120 }, { x: 180, y: 320 });
    await expect(pilula).toHaveAttribute("data-puxada", "concluido");
  });
});

test("no desktop o gesto some e quem atualiza é o botão da lateral", async ({ page }) => {
  // 1280 passa dos 64rem do `lg` — o mesmo ponto em que a TopBar (e com ela a
  // pílula) some e a lateral aparece.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/rankings?aba=artilharia");
  // A mesma corrida de hidratação do celular: clicar antes do onClick anexar
  // seguiria o href vazio numa navegação completa e "Atualizado" nunca viria.
  await esperarOGesto(page, "auto");

  const botao = page.getByRole("link", { name: "Atualizar" });
  await expect(botao).toBeVisible();

  // O caminho sem JS: href vazio resolve para a URL atual, query inclusa.
  expect(await botao.evaluate((el) => (el as HTMLAnchorElement).href)).toContain(
    "/rankings?aba=artilharia",
  );

  await botao.click();

  await expect(page.getByRole("link", { name: "Atualizado" })).toBeVisible();
  await expect(page).toHaveURL(/\/rankings\?aba=artilharia$/);
});
