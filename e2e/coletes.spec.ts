import { expect, test, type Locator, type Page } from "@playwright/test";
import { criarFut } from "./helpers";

// Os coletes personalizados de ponta a ponta: renomear e recolorir os times de
// um fut avulso pelo /gerenciar e pela súmula (e ver o resultado nos botões de
// gol e na página pública), e os coletes do grupo nomeando o sorteio.
//
// Mesma família de jogadores sem conta do sumula.spec: o seed nunca lhes dá
// conta, então nada aqui dispara aviso que outro spec leia.
const SEM_CONTA = ["Diego Ferreira", "Felipe Costa", "Igor Santana"];

const coluna = (page: Page, nome: string) =>
  page.locator("[data-coluna]").filter({ has: page.getByText(nome, { exact: true }) });

/** O bloco de edição de um time — o <fieldset> cuja legend é o nome atual. */
const blocoDoTime = (page: Page, nome: string) =>
  page.getByRole("group", { name: nome, exact: true });

/**
 * Abre o <details> "Nome e cor dos times" — só se estiver fechado. Depois de
 * um salvar, a página pode voltar com o bloco ainda aberto (DOM preservado na
 * navegação) ou fechado (remontado); clicar às cegas no <summary> fecharia o
 * aberto, e os rádios lá dentro sumiriam da árvore de acessibilidade.
 */
async function abrirNomeECor(page: Page) {
  const bloco = page.locator("details", { has: page.getByText("Nome e cor dos times") });
  if ((await bloco.getAttribute("open")) === null) await bloco.locator("summary").click();
}

/**
 * Escolhe uma cor como quem usa: tocando na amostra (o <label>, achado pelo
 * title). O rádio em si é `sr-only`, e um clique nele cai no span de fora —
 * o que importa é que o rádio ACABE marcado.
 */
async function escolherCor(bloco: Locator, nome: string) {
  await bloco.getByTitle(nome).click();
  await expect(bloco.getByRole("radio", { name: nome })).toBeChecked();
}

async function marcarSemConta(page: Page, nomes: string[]) {
  for (const nome of nomes) {
    await page.getByLabel("Buscar jogador").fill(nome);
    const linha = page.getByRole("listitem").filter({ hasText: nome });
    await linha.getByRole("button", { name: "Vai", exact: true }).click();
    await expect(linha.getByText("vai", { exact: true })).toBeVisible();
  }
}

test("renomeia e recolore os times pelo /gerenciar e pela súmula", async ({ page }) => {
  test.setTimeout(120_000);
  const urlPublica = await criarFut(page, { local: `Coletes E2E ${Date.now()}` });

  await page.goto(urlPublica);
  await page.getByRole("button", { name: "Vou", exact: true }).click();
  await expect(page.getByText("Na lista · 1")).toBeVisible();
  await page.getByRole("link", { name: "Gerenciar" }).click();
  await expect(page).toHaveURL(/\/gerenciar$/);
  await marcarSemConta(page, SEM_CONTA);
  await page.getByRole("button", { name: "Fechar lista e sortear" }).click();
  await expect(page.getByText("Times sorteados")).toBeVisible();

  // /gerenciar: o Preto vira "Com Colete", vermelho (uma amostra) — e a coluna
  // do editor já mostra o chip sólido na cor da amostra.
  await abrirNomeECor(page);
  const preto = blocoDoTime(page, "Preto");
  await preto.getByLabel("Nome").fill("Com Colete");
  await escolherCor(preto, "Vermelho");
  await preto.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByText("Nome e cor do time salvos")).toBeVisible();
  await expect(coluna(page, "Com Colete").locator("span[aria-hidden]").first()).toHaveCSS(
    "background-color",
    "rgb(217, 52, 42)",
  );

  // Súmula: o Branco vira "Sem Colete", vazado.
  await page.goto(`${urlPublica}/sumula`);
  await abrirNomeECor(page);
  const branco = blocoDoTime(page, "Branco");
  await branco.getByLabel("Nome").fill("Sem Colete");
  await escolherCor(branco, "Sem colete");
  await branco.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByText("Nome e cor do time salvos")).toBeVisible();

  // Ainda na súmula: o "Com Colete" ganha um tom fora das amostras pelo seletor
  // livre. Mexer no seletor tem que marcar "Outra cor" sozinho (o único script
  // do CamposDoColete) — e ao reabrir, o rádio e o seletor têm que voltar com
  // o tom gravado, não com uma amostra.
  //
  // Sai do `?ok=` do salvar anterior antes: o banner é o MESMO texto, e sem
  // isto o `toBeVisible` de baixo passaria no banner velho, antes de a segunda
  // gravação voltar.
  await page.goto(`${urlPublica}/sumula`);
  await abrirNomeECor(page);
  const comColete = blocoDoTime(page, "Com Colete");
  await comColete.getByLabel("Escolher outra cor").fill("#123456");
  await expect(comColete.getByRole("radio", { name: "Outra cor" })).toBeChecked();
  await comColete.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByText("Nome e cor do time salvos")).toBeVisible();
  await abrirNomeECor(page);
  await expect(blocoDoTime(page, "Com Colete").getByRole("radio", { name: "Outra cor" })).toBeChecked();
  await expect(blocoDoTime(page, "Com Colete").getByLabel("Escolher outra cor")).toHaveValue(
    "#123456",
  );

  // Os botões de gol dizem os nomes novos, e o chip é da cor escolhida —
  // sólido no tom livre, tracejado no time sem colete.
  await page.getByRole("button", { name: "Iniciar jogo" }).click();
  const golDoComColete = page.getByRole("button", { name: "Gol do Com Colete" });
  const golDoSemColete = page.getByRole("button", { name: "Gol do Sem Colete" });
  await expect(golDoComColete).toBeVisible();
  await expect(golDoSemColete).toBeVisible();
  await expect(golDoComColete.locator("span[aria-hidden]").first()).toHaveCSS(
    "background-color",
    "rgb(18, 52, 86)",
  );
  await expect(golDoSemColete.locator("span[aria-hidden]").first()).toHaveCSS(
    "border-top-style",
    "dashed",
  );

  // E a página pública também.
  await page.goto(urlPublica);
  await expect(page.getByText("Com Colete").first()).toBeVisible();
  await expect(page.getByText("Sem Colete").first()).toBeVisible();
});

test("os coletes do grupo nomeiam o sorteio dos futs do grupo", async ({ page }) => {
  test.setTimeout(120_000);
  const nomeDoGrupo = `Coletes E2E ${Date.now()}`;

  await page.goto("/grupos/novo");
  await page.getByLabel("Nome").fill(nomeDoGrupo);
  await page.getByRole("button", { name: "Criar grupo" }).click();
  await expect(page).toHaveURL(/\/grupo\/[^/]+\/gerenciar$/);

  const time1 = blocoDoTime(page, "Time 1");
  await time1.getByLabel("Nome").fill("Azulão");
  await escolherCor(time1, "Azul");
  const time2 = blocoDoTime(page, "Time 2");
  await time2.getByLabel("Nome").fill("Vermelhão");
  await escolherCor(time2, "Vermelho");
  await page.getByRole("button", { name: "Salvar coletes" }).click();
  await expect(page.getByText("Coletes do grupo salvos")).toBeVisible();

  // Um fut do grupo: as colunas do "montar" já mostram os nomes do grupo, e o
  // sorteio sai com eles. O segundo confirmado vem pelo cadastro do próprio
  // fut — quem tem linha de presença entra na lista mesmo sem ser do grupo.
  const urlPublica = await criarFut(page, {
    local: `Coletes do grupo E2E ${Date.now()}`,
    grupo: nomeDoGrupo,
  });
  await page.goto(urlPublica);
  await page.getByRole("button", { name: "Vou", exact: true }).click();
  await expect(page.getByText("Na lista · 1")).toBeVisible();
  await page.getByRole("link", { name: "Gerenciar" }).click();
  await expect(page).toHaveURL(/\/gerenciar$/);

  await page.getByText("Montar times na mão").click();
  await expect(coluna(page, "Azulão")).toBeVisible();
  await expect(coluna(page, "Vermelhão")).toBeVisible();

  const novo = `Novo Coletes ${Date.now()}`;
  await page.getByPlaceholder("Nome do jogador").fill(novo);
  await page.getByRole("button", { name: "Cadastrar e confirmar" }).click();
  await expect(page.getByText("2 confirmados", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Fechar lista e sortear" }).click();
  await expect(page.getByText("Times sorteados")).toBeVisible();
  await expect(coluna(page, "Azulão")).toBeVisible();
  await expect(coluna(page, "Vermelhão")).toBeVisible();
});
