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

  // Uma estrela por companheiro: o rádio em si é sr-only, então o clique vai no
  // rótulo visível da 5ª estrela (o title é o texto que o produto mostra).
  const estrelas5 = page.getByTitle("5 estrelas — estava impossível");
  const companheiros = await estrelas5.count();
  expect(companheiros).toBeGreaterThan(0);
  for (let i = 0; i < companheiros; i++) {
    await estrelas5.nth(i).click();
  }
  await expect(page.getByText("tudo pronto")).toBeVisible();

  await page
    .getByRole("button", { name: /Enviar \d+ avaliações|Atualizar avaliação/ })
    .click();
  await expect(
    page.getByText("Avaliação enviada. Dá para mudar enquanto o prazo não acabar."),
  ).toBeVisible();
});
