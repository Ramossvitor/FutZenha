import { expect, test } from "@playwright/test";
import { criarPelada } from "./helpers";

// O fluxo completo do admin numa pelada criada PELO spec (a do seed fica em
// paz): criar → presenças → sorteio → jogo com placar → tirar alguém da
// escalação → prévia de falta → encerrar → estado final.
//
// Os quatro marcados pela gestão são jogadores que o seed NUNCA dá conta
// (não jogaram a última pelada encerrada, de onde saem as contas demo) — o
// admin só marca por quem não tem acesso, e sem conta em campo além do `du`
// o encerramento não abre rodada de avaliação nova, o que manteria o
// avaliar.spec estável na segunda passada.
const SEM_CONTA = ["Diego Ferreira", "Felipe Costa", "Igor Santana", "Gabriel Martins"];
const FALTOSO = "Igor Santana";

test("admin cria, confirma, sorteia, lança placar, marca falta e encerra", async ({ page }) => {
  test.setTimeout(120_000);
  const local = `Encerrar E2E ${Date.now()}`;
  const urlPublica = await criarPelada(page, { local });

  // O próprio du confirma pela página pública (o nome do jogador dele varia
  // com o seed — o badge "você" é o jeito estável de encontrá-lo).
  await page.goto(urlPublica);
  await page.getByRole("button", { name: "Vou", exact: true }).click();
  await expect(page.getByText("Na lista · 1")).toBeVisible();
  await expect(page.getByText("você", { exact: true })).toBeVisible();

  // De volta à gestão, marca presença por quem não tem conta.
  await page.getByRole("link", { name: "Gerenciar" }).click();
  await expect(page).toHaveURL(/\/gerenciar$/);
  for (const nome of SEM_CONTA) {
    await page.getByLabel("Buscar jogador").fill(nome);
    const linha = page.getByRole("listitem").filter({ hasText: nome });
    await linha.getByRole("button", { name: "Vai", exact: true }).click();
    await expect(linha.getByText("vai", { exact: true })).toBeVisible();
  }
  await expect(page.getByText("5 confirmados", { exact: true })).toBeVisible();

  // Sorteio fecha a lista.
  await page.getByRole("button", { name: "Fechar lista e sortear" }).click();
  await expect(page.getByText("Times sorteados")).toBeVisible();

  // Novo jogo com placar 3 × 1 (a escalação é o snapshot dos dois times).
  const gols = page.getByLabel("Gols", { exact: true });
  await gols.first().fill("3");
  await gols.nth(1).fill("1");
  await page.getByRole("button", { name: "Adicionar" }).click();
  await expect(page.getByText("jogo 1")).toBeVisible();
  await expect(page.getByLabel(/^Gols do /).first()).toHaveValue("3");

  // Conferência da escalação: tira o faltoso do jogo e vê a prévia da falta.
  await page.getByRole("link", { name: "Conferir escalação e encerrar" }).click();
  await expect(page).toHaveURL(/\/gerenciar\/encerrar$/);
  await page
    .getByRole("listitem")
    .filter({ hasText: FALTOSO })
    .getByRole("button", { name: "Não jogou" })
    .click();
  await expect(page.getByText("vão contar falta")).toBeVisible();
  await expect(
    page.getByRole("listitem").filter({ hasText: FALTOSO }).getByText("não veio"),
  ).toBeVisible();

  // Porta de mão única.
  await page.getByRole("button", { name: "Encerrar a pelada" }).click();
  await expect(page).toHaveURL(/\/gerenciar$/);
  await expect(page.getByText(/Pelada encerrada — os resultados contam/)).toBeVisible();
  await expect(page.getByText("Encerrada", { exact: true })).toBeVisible();

  // Estado final na página pública: encerrada, placar de pé e o faltoso marcado.
  await page.getByRole("link", { name: "Ver página pública" }).click();
  await expect(page).toHaveURL(urlPublica);
  await expect(page.getByText("Encerrada", { exact: true })).toBeVisible();
  await expect(page.getByText("3 × 1")).toBeVisible();
  await expect(page.getByText("Não compareceram · 1")).toBeVisible();
  await expect(
    page.getByRole("listitem").filter({ hasText: FALTOSO }).getByText("faltou"),
  ).toBeVisible();
});
