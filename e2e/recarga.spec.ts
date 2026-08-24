import { expect, test } from "@playwright/test";

// A recarga no ambiente SEM gateway — que é exatamente como o E2E roda: a
// ausência de MP_ACCESS_TOKEN é o kill switch (o mesmo desenho da
// RESEND_API_KEY), e o build de teste não tem a credencial de propósito.
//
// O que este smoke prova é o kill switch inteiro: o botão some da tela de
// zenhas, e a rota direta (link velho no zap, aba aberta de antes) explica em
// vez de quebrar. O caminho FELIZ da recarga — QR, webhook, crédito — mora nos
// testes de integração, com gateway fake e assinatura de verdade; um E2E dele
// exigiria credencial no build, que é justamente o que o harness proíbe.

const CELULAR = { width: 390, height: 844 };

test("sem gateway, o botão de comprar zenhas não existe", async ({ page }) => {
  await page.setViewportSize(CELULAR);
  await page.goto("/zenhas");

  // A página carregou de verdade (o cartão de saldo está lá)...
  await expect(page.getByText("saldo", { exact: true })).toBeVisible();
  // ...e o caminho do dinheiro não: sem credencial não se promete pagamento.
  await expect(page.getByRole("link", { name: "Comprar zenhas" })).toHaveCount(0);
});

test("a rota direta da recarga explica a indisponibilidade", async ({ page }) => {
  await page.setViewportSize(CELULAR);
  await page.goto("/zenhas/recarga");

  await expect(page.getByText("A recarga não está disponível agora")).toBeVisible();
  // E nenhum pacote com preço em reais aparece — não existe meio-caminho.
  await expect(page.getByText(/R\$/)).toHaveCount(0);
});
