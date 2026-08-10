import { expect, test } from "@playwright/test";
import { criarPelada, loginPelaUI } from "./helpers";

test.describe("pelada lotada do seed", () => {
  // Estado COMPARTILHADO: a pelada é do seed, não do spec. A segunda passada do
  // e2e — e o retry do CI, que não roda o seed de novo — precisa encontrá-la
  // como a primeira encontrou (2 na espera).
  //
  // Por isso a saída mora no afterEach, e não no fim do teste: uma falha no
  // meio deixaria o `du` na espera, e o retry morreria já no "Lista de espera ·
  // 2" — falha determinística, com mensagem que esconde o erro de verdade.
  let urlDaPelada: string | null = null;

  test.afterEach(async ({ page }) => {
    if (!urlDaPelada) return;
    await page.goto(urlDaPelada);
    const entrar = page.getByRole("button", { name: "Entrar na espera" });
    const sair = page.getByRole("button", { name: "Fora", exact: true });
    // Espera a página assentar num dos dois estados antes de decidir — sem
    // isto, um isVisible() cedo demais leria "não está na espera" e não
    // limparia nada. Sair da espera não promove ninguém: a fila segue intacta.
    await expect(entrar.or(sair)).toBeVisible();
    if (await sair.isVisible()) {
      await sair.click();
      await expect(entrar).toBeVisible();
    }
    urlDaPelada = null;
  });

  test("du entra na lista de espera da pelada lotada do seed", async ({ page }) => {
    // A pelada lotada do seed é a "Próxima pelada" da home (os specs criam as
    // deles semanas depois, de propósito, para não roubar esse posto).
    await page.goto("/");
    await page.getByRole("link", { name: /Quadra do Zenha/ }).click();
    await expect(page).toHaveURL(/\/pelada\/\d+$/);
    // A partir daqui o afterEach tem o que desfazer.
    urlDaPelada = page.url();

    await expect(page.getByText("Marcada", { exact: true })).toBeVisible();
    await expect(page.getByText("/ 6 vagas")).toBeVisible();
    await expect(page.getByText("Lista de espera · 2")).toBeVisible();

    // Lotada: o CTA do du é a espera, não o "Vou".
    await page.getByRole("button", { name: "Entrar na espera" }).click();
    await expect(page.getByText("Lista de espera · 3")).toBeVisible();
    const minhaLinha = page.getByRole("listitem").filter({ hasText: "você" });
    await expect(minhaLinha.getByText("espera", { exact: true })).toBeVisible();
  });
});

test("quem sai abre vaga e o primeiro da espera sobe, com aviso", async ({ page }) => {
  test.setTimeout(120_000);

  // Cenário próprio com 2 vagas + 3 contas demo — estável por construção, sem
  // depender de qual jogador do seed cada conta demo virou.
  const local = `Espera E2E ${Date.now()}`;
  const urlPublica = await criarPelada(page, { local, vagas: 2 });

  // Troca de usuário na mesma página: limpa os cookies e loga pela UI.
  const trocarPara = async (usuario: string) => {
    await page.context().clearCookies();
    await loginPelaUI(page, usuario);
    await page.goto(urlPublica);
  };

  await trocarPara("ps");
  await page.getByRole("button", { name: "Vou", exact: true }).click();
  await expect(page.getByText("Na lista · 1")).toBeVisible();

  await trocarPara("cadu");
  await page.getByRole("button", { name: "Vou", exact: true }).click();
  await expect(page.getByText("Na lista · 2")).toBeVisible();

  // Lotou: tico só entra na espera.
  await trocarPara("tico");
  await page.getByRole("button", { name: "Entrar na espera" }).click();
  await expect(page.getByText("Lista de espera · 1")).toBeVisible();
  await expect(
    page.getByRole("listitem").filter({ hasText: "você" }).getByText("espera", { exact: true }),
  ).toBeVisible();

  // ps desiste: abre vaga e tico sobe sozinho.
  await trocarPara("ps");
  await page.getByRole("button", { name: "Fora", exact: true }).click();
  await expect(page.getByText("Na lista · 2")).toBeVisible();
  await expect(page.getByText("Lista de espera")).toBeHidden();

  // O promovido é avisado.
  await trocarPara("tico");
  await expect(page.getByText("você", { exact: true })).toBeVisible();
  await page.goto("/notificacoes");
  await expect(page.getByText("Abriu vaga: você está na lista").first()).toBeVisible();
});
