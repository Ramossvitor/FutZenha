import { expect, test } from "@playwright/test";
import { pngDeUmaCor } from "../src/test/fixtures-imagem";

// O cadastro da loja pela TELA, com upload de arquivo de verdade.
//
// É o caminho que nenhum teste de integração alcança: o `<input type="file">`
// enchendo o FormData, a Server Action recebendo um `File` e os bytes voltando
// pela rota pública de imagem. O ciclo inteiro do produto novo — o admin decide
// o que a loja vende, sem deploy.
//
// `du` é o admin da plataforma do seed, e o storageState que todos os specs
// usam já atravessa o requirePlatformAdmin — nenhuma fixture nova.

/** Um nome que não colide com o catálogo do seed, para os seletores serem exatos. */
const NOME = "Badge do E2E";

test("cria um badge com imagem, ele aparece na loja, e some ao ser retirado", async ({ page }) => {
  await page.goto("/admin/loja/novo?tipo=badge");

  await page.getByLabel("Nome").fill(NOME);
  await page.getByLabel("Preço").fill("10");
  await page.getByLabel("Descrição").fill("Cadastrado pelo smoke.");
  // Sem passar pelo recorte do navegador: o `setInputFiles` põe o arquivo
  // direto, que é também o caminho de quem está sem JavaScript. O servidor
  // valida os magic bytes de qualquer jeito.
  await page.getByLabel("Imagem").setInputFiles({
    name: "badge.png",
    mimeType: "image/png",
    buffer: pngDeUmaCor("#c81e1e"),
  });

  await page.getByRole("button", { name: "Criar item" }).click();

  await expect(page).toHaveURL(/\/admin\/loja\/\d+\?ok=item-criado/);
  const url = new URL(page.url());
  const id = url.pathname.split("/").pop()!;

  // A arte que subiu já é a que a tela de edição desenha.
  await expect(page.locator(`img[src^="/imagens/loja/${id}/"]`).first()).toBeVisible();

  // E ela chegou na loja de quem compra, sem deploy nenhum no meio.
  await page.goto("/loja");
  await expect(page.getByRole("link", { name: new RegExp(`^${NOME},`) })).toBeVisible();

  // Retirar de venda tira da vitrine — e é o único jeito de "remover" um item,
  // porque apagar quebraria o perfil de quem comprou.
  await page.goto(`/admin/loja/${id}`);
  await page.getByRole("button", { name: "Tirar de venda" }).click();
  await expect(page).toHaveURL(/\/admin\/loja\?ok=item-retirado/);

  await page.goto("/loja");
  await expect(page.getByRole("link", { name: new RegExp(`^${NOME},`) })).toHaveCount(0);
});

test("recusa um arquivo que não é imagem, com texto e sem criar nada", async ({ page }) => {
  await page.goto("/admin/loja/novo?tipo=badge");

  await page.getByLabel("Nome").fill("GIF recusado");
  await page.getByLabel("Preço").fill("10");
  // GIF é recusado pelos MAGIC BYTES, e não pela extensão nem pelo mime que o
  // navegador declara — este arquivo se apresenta como PNG de propósito.
  await page.getByLabel("Imagem").setInputFiles({
    name: "badge.png",
    mimeType: "image/png",
    buffer: Buffer.from("GIF89a\0\0\0\0", "latin1"),
  });

  await page.getByRole("button", { name: "Criar item" }).click();

  await expect(page).toHaveURL(/erro=imagem-invalida/);
  // Pelo `role=alert` do banner, e não pelo texto solto: a ajuda do campo diz
  // quais formatos servem com quase as mesmas palavras, e o que se prova aqui é
  // que a RECUSA foi explicada — não que a frase existe em algum lugar da tela.
  // Dentro do `main` porque o Next põe um `role=alert` vazio no fim do body (o
  // anunciador de rota), e ele casaria o seletor sem ter nada a ver com isto.
  await expect(page.locator("main").getByRole("alert")).toContainText(/PNG, JPEG ou WebP/i);

  await page.goto("/loja");
  await expect(page.getByRole("link", { name: /^GIF recusado,/ })).toHaveCount(0);
});

test("o multiplicador não pode ser apagado, e a tela diz por quê", async ({ page }) => {
  await page.goto("/admin/loja");

  // A lista não faz do nome um link — a linha inteira carrega prévia, preço e
  // vendas, e o destino é o botão "Editar" dela. Filtrar a `<li>` pelo nome é o
  // que amarra o clique ao item certo.
  await page
    .locator("li")
    .filter({ hasText: "Multiplicador de nota" })
    .getByRole("link", { name: "Editar" })
    .click();
  await expect(page).toHaveURL(/\/admin\/loja\/\d+$/);

  // O botão de apagar NÃO existe para ele: um botão que sempre falha ensina o
  // admin a ignorar mensagem de erro. O que existe é a explicação.
  await expect(page.getByRole("button", { name: "Apagar item" })).toHaveCount(0);
  await expect(page.getByText(/efeito dele é (código|implementado)/i).first()).toBeVisible();
});

test("o preço da loja saiu do painel de zenhas e aponta para cá", async ({ page }) => {
  await page.goto("/admin/zenhas");

  // O formulário de preços não existe mais — o número tem um dono só.
  await expect(page.getByRole("button", { name: "Salvar preços" })).toHaveCount(0);
  // E a tela diz para onde ir, porque é aqui que o admin chega procurando.
  await page.getByRole("link", { name: /Editar Multiplicador de nota|Ir à loja/ }).click();
  await expect(page).toHaveURL(/\/admin\/loja/);
});
