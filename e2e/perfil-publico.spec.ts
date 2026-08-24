import { expect, test } from "@playwright/test";

// O perfil público é a porta da parte "comunidade": tem que dar para chegar
// nele pelo nome de qualquer jogador e para mandar o link no zap. O smoke cobre
// os dois caminhos de entrada (a ponte do /perfil e um nome de ranking) e o
// ?next= do proxy, que é o que salva o link aberto por quem está deslogado.

test("do /perfil dá para abrir o próprio perfil público", async ({ page }) => {
  await page.goto("/perfil");
  await page.getByRole("link", { name: "Meu perfil público" }).click();

  await expect(page).toHaveURL(/\/jogador\/[a-z0-9._-]+$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText("Números", { exact: true })).toBeVisible();
  // A volta para a área privada só existe no próprio perfil.
  await expect(page.getByRole("link", { name: "Minha área privada" })).toBeVisible();
});

test("o nome no ranking leva ao perfil de quem é", async ({ page }) => {
  await page.goto("/rankings");

  const primeiroNome = page.locator('a[href^="/jogador/"]').first();
  await expect(primeiroNome).toBeVisible();
  // O destino do próprio link, e não o texto dele: a linha do ranking mostra o
  // apelido quando existe e o nome inteiro quando não, enquanto o h1 do perfil
  // mostra o apelido ou só o PRIMEIRO nome. Comparar os dois passava por acaso,
  // conforme quem tivesse apelido caísse no topo da tabela do seed.
  const destino = await primeiroNome.getAttribute("href");
  expect(destino).toMatch(/^\/jogador\/[a-z0-9._-]+$/);
  await primeiroNome.click();

  await expect(page).toHaveURL(new RegExp(`${destino}$`));
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("a URL antiga, com o id no lugar do slug, não existe mais", async ({ page }) => {
  // O motivo de tudo isto: /jogador/1 enumerava a plataforma. Logado — o
  // storageState default do arquivo — quem recusa é o `ehSlug`, sem nem
  // consultar o banco; deslogado o proxy nem deixaria a URL chegar lá.
  await page.goto("/jogador/1");

  // A asserção é o CONTEÚDO, e não o status: o `notFound()` do App Router
  // desenha a tela de erro, mas a resposta já saiu com 200 porque o shell do
  // layout foi enviado antes de a página resolver. Vale para todo notFound()
  // do app, não é particularidade desta rota — e o que importa aqui é que o
  // perfil de ninguém aparece.
  await expect(page.getByRole("heading", { name: /Essa bola saiu/ })).toBeVisible();
  await expect(page.getByText("Números", { exact: true })).toHaveCount(0);
});

test.describe("deslogado", () => {
  // O storageState do `du` pularia o login, que é justamente o que este teste
  // exercita.
  test.use({ storageState: { cookies: [], origins: [] } });

  test("o link compartilhado pede login e devolve à página certa", async ({ page }) => {
    // Endereço fixo do seed. Antes isto era `/jogador/1` e só dava para conferir
    // a URL de volta: o seed apaga as tabelas sem reiniciar as sequences, então
    // o id 1 deixava de existir depois da primeira rodada e a página virava 404.
    // O slug sai do nome e não anda com a sequence, então dá para exigir também
    // que o perfil ABRA — que é o que o link no zap promete.
    await page.goto("/jogador/andre-souza");
    await expect(page).toHaveURL(/\/login\?next=/);

    await page.getByLabel("Usuário").fill("du");
    await page.getByLabel("Senha").fill("senha123");
    await page.getByRole("button", { name: "Entrar" }).click();

    await expect(page).toHaveURL(/\/jogador\/andre-souza$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText("Números", { exact: true })).toBeVisible();
  });
});
