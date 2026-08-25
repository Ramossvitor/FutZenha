import { expect, request, test } from "@playwright/test";

// A loja ponta a ponta: comprar um badge, ver que ele já entrou na vitrine, e
// achá-lo no perfil público E ao lado do nome num ranking. É o único caminho que
// atravessa carteira, inventário, vitrine, a rota pública da imagem e a página
// que qualquer um abre — de uma vez.
//
// O chip do saldo aparece em DOIS lugares diferentes e nenhum dos dois em
// ambos os tamanhos: a TopBar é `lg:hidden` e a Sidebar é `lg:flex`. Por isso
// os testes abaixo declaram o viewport de propósito — sem isso, o de celular
// passaria pelo chip da Sidebar e não provaria nada sobre o celular, que é o
// alvo do produto.

const CELULAR = { width: 390, height: 844 };

// O badge que o teste compra, pelo NOME e não pelo id: o id é linha de banco e
// muda a cada seed, mas o nome é o que o seed escreve e o que a tela mostra nos
// três lugares que este teste visita. Ver `seedLoja` em src/db/seed.ts.
const BADGE = "Avaí";

test("compra um badge e ele aparece no perfil e ao lado do nome", async ({ page }) => {
  await page.setViewportSize(CELULAR);

  // No celular a loja não está na barra de abas (são quatro e é o teto), então
  // o caminho real de quem usa é pelo /perfil. Testar pelo link direto pularia
  // justamente a navegação que precisa existir.
  await page.goto("/perfil");
  await page.getByRole("link", { name: "Loja" }).click();
  await expect(page).toHaveURL(/\/loja$/);

  // Um BADGE, e não o primeiro item da vitrine: o primeiro é sempre o
  // multiplicador (a prateleira dele abre a loja), e ele não vai para vitrine
  // nenhuma — é justamente a metade que este teste existe para atravessar.
  await page.getByRole("link", { name: new RegExp(`^${BADGE},`) }).click();
  await expect(page).toHaveURL(/\/loja\/\d+$/);

  // A arte em tamanho grande na confirmação: é o que a pessoa está comprando.
  await expect(page.locator('img[src^="/imagens/loja/"]').first()).toBeVisible();

  await page.getByRole("button", { name: /comprar/i }).click();

  // A compra termina no inventário — e o badge já entrou na vitrine sozinho,
  // que é a promessa do banner. Sem isso o produto voltaria a ser "comprei e
  // agora não sei o que fazer".
  await expect(page).toHaveURL(/\/perfil\/inventario/);
  // Na LINHA do badge comprado, e não em qualquer "em destaque" da página: a
  // descrição da seção escreve essas mesmas palavras, e casaria mesmo que a
  // compra não tivesse posto nada na vitrine.
  await expect(
    page.locator("li").filter({ hasText: BADGE }).getByText("em destaque"),
  ).toBeVisible();

  // O perfil público é o fim da linha do que a pessoa comprou. Pelo `alt` da
  // imagem, que é o nome do item: é assim que um leitor de tela a encontra.
  await page.getByRole("link", { name: "Ver meu perfil" }).click();
  await expect(page).toHaveURL(/\/jogador\/[a-z0-9._-]+$/);
  await expect(page.getByRole("img", { name: BADGE }).first()).toBeVisible();

  // E o destaque sai do perfil: ele anda junto do nome nas listas, numa tela que
  // não é sobre o dono dela. Não é o único que faz esse caminho — a cor do nome
  // faz o mesmo, e é o e2e/cor-do-nome.spec.ts quem guarda a outra metade.
  await page.goto("/rankings");
  await expect(page.locator('img[src^="/imagens/loja/"]').first()).toBeVisible();
});

test("a imagem do badge é servida com cache imutável, sem exigir login", async ({ page }) => {
  await page.goto("/loja");
  const src = await page.locator('img[src^="/imagens/loja/"]').first().getAttribute("src");
  expect(src).toMatch(/^\/imagens\/loja\/\d+\/[0-9a-f]{32}$/);

  // Um contexto NOVO, sem o storageState dos specs: a rota é pública de
  // propósito, porque o destaque aparece em /rankings e /fut/[id], que qualquer
  // um abre. Se ela cair sob um prefixo protegido, o sintoma é badge quebrado só
  // para quem NÃO está logado — e é isto aqui que percebe. Usar
  // `page.request` não provaria nada: ele carrega o cookie da sessão.
  const semSessao = await request.newContext({ baseURL: "http://localhost:3000" });
  const resposta = await semSessao.get(src!);
  expect(resposta.status()).toBe(200);
  expect(resposta.headers()["content-type"]).toContain("image/");
  expect(resposta.headers()["cache-control"]).toContain("immutable");
  await semSessao.dispose();
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
