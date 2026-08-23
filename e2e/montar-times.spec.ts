import { expect, test, type Locator, type Page } from "@playwright/test";
import { arrastarComODedo, criarFut } from "./helpers";

// O editor de times de ponta a ponta: montar na mão (botões de colete) e fechar
// a lista sem sorteio; depois, com a lista fechada, mover por arrasto — com o
// mouse e com o dedo (touch via CDP), que são os dois jeitos de o organizador
// usar isso de verdade.
//
// Mesma família de jogadores sem conta do encerrar.spec: o seed nunca lhes dá
// conta, então o fechamento não dispara aviso a ninguém que outro spec leia.
const SEM_CONTA = ["Diego Ferreira", "Felipe Costa", "Igor Santana"];

// O projeto é Desktop Chrome, sem toque: o Chromium descarta o touch do CDP
// a menos que a emulação esteja ligada — e é o `hasTouch` do contexto que a
// liga (é o que o perfil Pixel 5 do zoom-mobile.spec traz embutido). O mouse
// continua funcionando com ele ligado.
test.use({ hasTouch: true });

const coluna = (page: Page, nome: string) =>
  page
    .locator("[data-coluna]")
    .filter({ has: page.getByText(nome, { exact: true }) });

const alcasDe = (page: Page, nome: string) =>
  coluna(page, nome).getByRole("button", { name: /^Arrastar / });

/**
 * Com a lista fechada cada movimento é uma Server Action em voo, e a linha
 * fica `aria-busy` até ela voltar. Recarregar antes disso aborta o request —
 * a tela otimista já mostrava o jogador no time, mas o banco nunca soube.
 */
const esperarGravar = (page: Page) => expect(page.locator("li[aria-busy]")).toHaveCount(0);

/**
 * Arrasta uma alça até a coluna `destino` com o mouse e só solta quando o
 * editor marcar a coluna como alvo (`data-alvo`). Esperar o sinal, e não
 * adivinhar pela posição, é o que tira a corrida com o layout que ainda está
 * assentando logo depois de uma navegação.
 *
 * As caixas são relativas ao viewport e a seção de times fica abaixo da
 * dobra: sem rolar, o gesto cairia fora da tela, no <html>, e o browser o
 * tomaria como scroll (pointercancel).
 */
async function arrastarComOMouse(page: Page, alca: Locator, destino: string) {
  await alca.scrollIntoViewIfNeeded();
  const de = (await alca.boundingBox())!;
  await page.mouse.move(de.x + de.width / 2, de.y + de.height / 2);
  await page.mouse.down();
  const alvo = coluna(page, destino);
  await expect(async () => {
    const ate = (await alvo.boundingBox())!;
    await page.mouse.move(ate.x + ate.width / 2, ate.y + ate.height / 2, { steps: 6 });
    await expect(alvo).toHaveAttribute("data-alvo", "true", { timeout: 500 });
  }).toPass();
  await page.mouse.up();
}

test("monta os times na mão, fecha a lista e ajusta por arrasto", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const urlPublica = await criarFut(page, {
    local: `Montar E2E ${Date.now()}`,
  });

  await page.goto(urlPublica);
  await page.getByRole("button", { name: "Vou", exact: true }).click();
  await expect(page.getByText("Na lista · 1")).toBeVisible();

  await page.getByRole("link", { name: "Gerenciar" }).click();
  await expect(page).toHaveURL(/\/gerenciar$/);
  for (const nome of SEM_CONTA) {
    await page.getByLabel("Buscar jogador").fill(nome);
    const linha = page.getByRole("listitem").filter({ hasText: nome });
    await linha.getByRole("button", { name: "Vai", exact: true }).click();
    await expect(linha.getByText("vai", { exact: true })).toBeVisible();
  }
  await expect(page.getByText("4 confirmados", { exact: true })).toBeVisible();

  // O caminho sem sorteio fica fechado por padrão.
  await page.getByText("Montar times na mão").click();
  await expect(alcasDe(page, "Sem time")).toHaveCount(4);

  // Dois para cada lado pelos botõezinhos de colete.
  for (let i = 0; i < 2; i++) {
    await page
      .getByRole("button", { name: /para o Preto$/ })
      .first()
      .click();
  }
  for (let i = 0; i < 2; i++) {
    await page
      .getByRole("button", { name: /para o Branco$/ })
      .first()
      .click();
  }
  await expect(alcasDe(page, "Sem time")).toHaveCount(0);
  await expect(alcasDe(page, "Preto")).toHaveCount(2);
  await expect(alcasDe(page, "Branco")).toHaveCount(2);

  // O rascunho sobrevive ao refresh — mora no browser até o submit.
  await page.reload();
  await page.getByText("Montar times na mão").click();
  await expect(alcasDe(page, "Preto")).toHaveCount(2);
  await expect(alcasDe(page, "Branco")).toHaveCount(2);

  await page
    .getByRole("button", { name: "Fechar lista com esses times" })
    .click();
  await expect(page.getByText("Times sorteados")).toBeVisible();
  await expect(alcasDe(page, "Preto")).toHaveCount(2);
  await expect(alcasDe(page, "Branco")).toHaveCount(2);

  // Lista fechada: arrasto com o mouse, do Preto para o Branco.
  await arrastarComOMouse(page, alcasDe(page, "Preto").first(), "Branco");
  await expect(alcasDe(page, "Branco")).toHaveCount(3);
  await expect(alcasDe(page, "Preto")).toHaveCount(1);
  await esperarGravar(page);

  // E com o dedo, do Branco de volta para o Preto — times desiguais são
  // permitidos de propósito, então o Preto volta a 2 e o Branco fica com 2.
  await page.reload();
  await expect(alcasDe(page, "Branco")).toHaveCount(3);
  // A contagem acima já bate no HTML do servidor, ANTES de hidratar — e o
  // gesto precisa dos handlers de ponteiro, que só existem depois. O mouse
  // de cima não sofreu disso porque veio depois de cliques que esperaram.
  await page.waitForLoadState("networkidle");
  const alcaTouch = alcasDe(page, "Branco").first();
  await alcaTouch.scrollIntoViewIfNeeded();
  const deTouch = (await alcaTouch.boundingBox())!;
  const ateTouch = (await coluna(page, "Preto").boundingBox())!;
  await arrastarComODedo(
    page,
    { x: deTouch.x + deTouch.width / 2, y: deTouch.y + deTouch.height / 2 },
    { x: ateTouch.x + ateTouch.width / 2, y: ateTouch.y + ateTouch.height / 2 },
  );
  await expect(alcasDe(page, "Preto")).toHaveCount(2);
  await expect(alcasDe(page, "Branco")).toHaveCount(2);
  await esperarGravar(page);

  // E o "×" tira do time: quem fica sem colete aparece em "Sem time".
  await page
    .getByRole("button", { name: /^Tirar .* do time$/ })
    .first()
    .click();
  await expect(alcasDe(page, "Sem time")).toHaveCount(1);
  await esperarGravar(page);
  await page.reload();
  await expect(alcasDe(page, "Sem time")).toHaveCount(1);
});
