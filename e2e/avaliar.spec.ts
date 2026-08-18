import { expect, test } from "@playwright/test";

// A rodada aberta do seed é alcançada pelos avisos (/notificacoes), nunca por
// id hardcoded. O aviso "Avalie seus companheiros" sobrevive entre as duas
// passadas do e2e — na segunda, o formulário aparece pré-preenchido e o botão
// vira "Atualizar avaliação"; o spec cobre os dois estados.

test("chega na rodada aberta pelos avisos, dá as notas e vê a confirmação", async ({ page }) => {
  await page.goto("/notificacoes");
  await page.getByRole("link", { name: /Avalie seus companheiros/ }).first().click();

  await expect(page).toHaveURL(/\/avaliar\/\d+$/);
  await expect(page.getByText("Como foi")).toBeVisible();
  await expect(page.getByText("Ninguém vai saber que foi você.")).toBeVisible();

  // A lista de cobrança e o botão de compartilhar são asseverados ANTES do
  // envio: se este for o último avaliador pendente, a rodada fecha por
  // completude no submit e a seção some (ela só existe com a rodada aberta).
  await expect(page.getByText("Quem já avaliou")).toBeVisible();
  await expect(page.getByRole("button", { name: "Cobrar no WhatsApp" })).toBeVisible();

  // Uma nota por companheiro: o rádio em si é sr-only, então o clique vai no
  // rótulo visível (o title vem de rotuloDeEstrelas). O `exact` é obrigatório —
  // por substring, "5 estrelas" casaria também "0,5 estrelas" … "4,5 estrelas".
  const meias5 = page.getByTitle("5 estrelas", { exact: true });
  const companheiros = await meias5.count();
  expect(companheiros).toBeGreaterThan(0);

  // O primeiro leva MEIA estrela (3,5) — é o clique na metade esquerda da 4ª
  // estrela, e o mostrador do card confirma o valor. Os demais levam 5.
  await page.getByTitle("3,5 estrelas", { exact: true }).first().click();
  await expect(page.getByText("3,5", { exact: true }).first()).toBeVisible();
  for (let i = 1; i < companheiros; i++) {
    await meias5.nth(i).click();
  }
  await expect(page.getByText("tudo pronto")).toBeVisible();

  await page
    .getByRole("button", { name: /Enviar \d+ avaliações|Atualizar avaliação/ })
    .click();
  await expect(
    page.getByText("Avaliação enviada. Dá para mudar enquanto o prazo não acabar."),
  ).toBeVisible();
});
