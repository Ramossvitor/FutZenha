import { devices, expect, test } from "@playwright/test";

// Perfil de celular + contexto limpo. /login é pública e junta num lugar só os
// alvos do teste (input de texto, input de senha, submit), então não depende de
// seed nem de sessão — e o storageState do `du` esconderia o formulário, porque
// logado /login redireciona para a home.
test.use({ ...devices["Pixel 5"], storageState: { cookies: [], origins: [] } });

test("campo no mobile tem 16px — abaixo disso o iOS dá zoom sozinho ao focar", async ({ page }) => {
  await page.goto("/login");

  // Guarda da emulação, e vem antes do resto de propósito: os 16px saem de um
  // `pointer-coarse:`, então se o perfil do Playwright deixar de casar
  // `pointer: coarse` o assert abaixo passaria a medir o desktop — verde
  // testando nada.
  const ponteiroGrosso = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
  expect(ponteiroGrosso, "emulação de toque do Playwright").toBe(true);

  for (const campo of ["Usuário", "Senha"]) {
    const fonte = await page
      .getByLabel(campo)
      .evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));
    expect(fonte, `campo "${campo}"`).toBeGreaterThanOrEqual(16);
  }
});

test("duplo-toque não dá zoom, e a pinça continua liberada", async ({ page }) => {
  await page.goto("/login");

  // Uma regra no body cobre a árvore inteira: touch-action resolve pela
  // interseção com os ancestrais.
  const touchAction = await page.evaluate(() => getComputedStyle(document.body).touchAction);
  expect(touchAction).toBe("manipulation");

  // O zoom intencional é requisito, não efeito colateral: matar o duplo-toque
  // com `user-scalable=no` / `maximum-scale` no viewport tira da pessoa a pinça
  // junto (WCAG 1.4.4). Este assert existe para esse atalho não voltar.
  const viewport = (await page.locator('meta[name="viewport"]').getAttribute("content")) ?? "";
  expect(viewport).toContain("width=device-width");
  expect(viewport).not.toMatch(/user-scalable\s*=\s*no|maximum-scale/);
});
