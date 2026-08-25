import { expect, test } from "@playwright/test";

// A cor do nome ponta a ponta: o admin cadastra, o jogador compra, equipa — e o
// nome sai colorido NA LISTA, que é onde o cosmético tem público.
//
// O perfil sozinho não provava nada aqui: ele lê a cor por outro caminho
// (carregarVitrine, um jogador por vez). O que este teste guarda é o caminho em
// LOTE — `lerCosmeticosDoNome` + a prop do `NomeJogador` —, que é o que fazia
// falta: quem comprava "seu nome, na cor que você escolher" via o efeito só numa
// tela que o dono visita sozinho.
//
// `du` é o admin da plataforma do seed, e o storageState que todos os specs usam
// já atravessa o requirePlatformAdmin — nenhuma fixture nova.
//
// PREÇO ZERO de propósito, e não a "Nome brasa" do seed: os specs dividem um
// banco só (`workers: 1`), e o saldo de fixture é 320 — gastar 200 aqui deixaria
// o badge de 250 do loja.spec sem saldo. Item de graça não passa pelo débito
// (ver `comprar`), então este teste não mexe na carteira de ninguém.
const NOME = "Cor do E2E";
const COR = "#ff00ff";
const COR_RGB = "rgb(255, 0, 255)";

test("a cor comprada pinta o nome na lista, e sair de cena a apaga", async ({ page }) => {
  await page.goto("/admin/loja/novo?tipo=cor_do_nome");
  await page.getByLabel("Nome").fill(NOME);
  await page.getByLabel("Preço").fill("0");
  // Magenta puro: nenhum token do tema chega perto, então o `toHaveCSS` abaixo
  // só passa se a cor VEIO do item — e não do `text-fg` de sempre.
  await page.getByLabel("Cor").fill(COR);
  await page.getByRole("button", { name: "Criar item" }).click();
  await expect(page).toHaveURL(/\/admin\/loja\/\d+\?ok=item-criado/);

  await page.goto("/loja");
  await page.getByRole("link", { name: new RegExp(`^${NOME},`) }).click();
  await page.getByRole("button", { name: /comprar/i }).click();
  await expect(page).toHaveURL(/\/perfil\/inventario/);

  // A cor já entrou no slot sozinha — `colocarAoComprar` equipa o cosmético de
  // slot na hora, como põe o badge na vitrine. Comprar e ficar sem efeito seria
  // "comprei e agora não sei o que fazer", que é o que essa regra evita. O botão
  // que sobra é o de TIRAR: é ele que prova que o item está em uso.
  await expect(
    page.locator("li").filter({ hasText: NOME }).getByRole("button", { name: "Tirar" }),
  ).toBeVisible();

  // O endereço público do dono da cor, para achar a LINHA dele na lista: o
  // ranking é ordenado por nota, então "a primeira linha" não é ninguém em
  // particular — e um seletor solto passaria pintando o nome de outro.
  const meuPerfil = await page
    .getByRole("link", { name: "Ver meu perfil" })
    .getAttribute("href");

  // O ranking: uma lista sobre o grupo inteiro, não sobre o dono da cor. É o
  // lugar de onde a cor não saía.
  await page.goto("/rankings");
  const nomeNaLista = page.locator(`a[href="${meuPerfil}"] span.truncate`).first();
  await expect(nomeNaLista).toHaveCSS("color", COR_RGB);

  // E o /perfil, que NÃO pintava: o h1 dele era `text-fg` fixo e só passou a
  // usar o mesmo helper das listas agora. Quem já pintava era o /jogador/[slug],
  // por outro caminho de leitura — esta linha guarda o buraco que sobrava, o
  // dono da cor não a vendo na única tela que ele abre todo dia.
  await page.goto("/perfil");
  await expect(page.getByRole("heading", { level: 1 })).toHaveCSS("color", COR_RGB);

  // Tirar do slot devolve o nome ao tom do tema em TODA lista. Sem este trecho o
  // teste passaria com uma cor grudada para sempre no HTML.
  await page.goto("/perfil/inventario");
  await page.locator("li").filter({ hasText: NOME }).getByRole("button", { name: "Tirar" }).click();
  await expect(
    page.locator("li").filter({ hasText: NOME }).getByRole("button", { name: "Equipar" }),
  ).toBeVisible();

  await page.goto("/rankings");
  await expect(page.locator(`a[href="${meuPerfil}"] span.truncate`).first()).not.toHaveCSS(
    "color",
    COR_RGB,
  );
});
