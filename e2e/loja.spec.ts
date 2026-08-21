import { expect, test } from "@playwright/test";

// A loja ponta a ponta: comprar, ver o saldo mudar, equipar e ver o selo no
// perfil público. É o único caminho que atravessa carteira, inventário, itens
// equipados e a página pública de uma vez.
//
// O chip do saldo aparece em DOIS lugares diferentes e nenhum dos dois em
// ambos os tamanhos: a TopBar é `lg:hidden` e a Sidebar é `lg:flex`. Por isso
// os testes abaixo declaram o viewport de propósito — sem isso, o de celular
// passaria pelo chip da Sidebar e não provaria nada sobre o celular, que é o
// alvo do produto.

const CELULAR = { width: 390, height: 844 };

// O cosmético que o teste compra. Cravado, e com o rótulo junto, porque o
// mesmo item tem que ser reconhecível na vitrine, no inventário e no perfil.
const SELO = "dono-da-bola";
const NOME_DO_SELO = "Dono da bola";

test("compra um selo, equipa, e ele aparece no perfil público", async ({ page }) => {
  await page.setViewportSize(CELULAR);

  // No celular a loja não está na barra de abas (são quatro e é o teto), então
  // o caminho real de quem usa é pelo /perfil. Testar pelo link direto pularia
  // justamente a navegação que precisa existir.
  await page.goto("/perfil");
  await page.getByRole("link", { name: "Loja" }).click();
  await expect(page).toHaveURL(/\/loja$/);

  // Um COSMÉTICO, e não o primeiro item da vitrine: o primeiro é sempre o
  // multiplicador (slot `null`, que a ordenação põe na frente), e ele não tem
  // slot — não dá para equipar, que é justamente a metade que este teste existe
  // para atravessar. O id é cravado porque a página de confirmação e o selo do
  // perfil precisam ser o MESMO item, e "o primeiro badge" mudaria de identidade
  // no dia em que o catálogo ganhasse um mais barato.
  await page.locator(`a[href="/loja/${SELO}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/loja/${SELO}$`));

  await page.getByRole("button", { name: /comprar/i }).click();

  // A compra termina no inventário, e não na vitrine: cosmético comprado ainda
  // precisa ser equipado.
  await expect(page).toHaveURL(/\/perfil\/inventario/);
  await expect(page.getByText(/comprad/i).first()).toBeVisible();

  // Equipar é o que liga o inventário ao perfil público. Sem este passo o teste
  // não prova nada sobre `zenha_equipados`, que é a tabela que a página pública
  // lê.
  await page.getByRole("button", { name: "Equipar" }).first().click();
  // Pelo slug da query, e não pelo texto do banner: o texto mora em
  // src/lib/mensagens.ts e é reescrito quando alguém acha uma frase melhor — o
  // slug é o contrato entre a action e a tela, e é ele que tem teste dos dois
  // lados.
  await expect(page).toHaveURL(/ok=item-equipado/);

  // E o selo aparece na página que qualquer um vê — o fim da linha do que a
  // pessoa comprou.
  await page.getByRole("link", { name: "Ver meu perfil" }).click();
  await expect(page).toHaveURL(/\/jogador\/\d+$/);
  await expect(page.getByText(NOME_DO_SELO).first()).toBeVisible();
});

test("o extrato mostra a compra com o sinal escrito", async ({ page }) => {
  await page.setViewportSize(CELULAR);
  await page.goto("/perfil");
  await page.getByRole("link", { name: "Minhas zenhas" }).click();

  await expect(page).toHaveURL(/\/zenhas$/);
  // Os DOIS sinais, e não só o crédito: o que este teste existe para provar é
  // que o sinal vem ESCRITO, não só na cor — e cor sozinha não carrega
  // informação. Provar isso só no `+` deixaria de fora justamente a única linha
  // negativa do extrato, que é a compra.
  //
  // O crédito é o saldo de fixture do seed, a primeira linha de todo mundo. O
  // débito vem do teste de compra acima: as specs compartilham um banco só
  // (`workers: 1`, `fullyParallel: false`), e é essa ordem que faz a linha
  // existir aqui.
  await expect(page.getByText(/^\+\d/).first()).toBeVisible();
  await expect(page.getByText(/^[−-]\d/).first()).toBeVisible();
});

test("o chip do saldo aparece no topo do celular e leva ao extrato", async ({ page }) => {
  await page.setViewportSize(CELULAR);
  await page.goto("/");

  // Dentro do header da TopBar, e não em qualquer lugar da página: é a
  // presença NELE que este teste existe para provar. O seletor é o href, e não
  // o texto: /zenha/i casaria também a marca "FutZenha — início", que mora no
  // mesmo header.
  const chip = page.locator('header a[href="/zenhas"]');
  await expect(chip).toBeVisible();
  await chip.click();
  await expect(page).toHaveURL(/\/zenhas$/);
});

test("no desktop o saldo e a loja aparecem na lateral", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");

  const lateral = page.locator("aside").first();
  await expect(lateral.locator('a[href="/loja"]')).toBeVisible();
  await expect(lateral.locator('a[href="/zenhas"]')).toBeVisible();
});
