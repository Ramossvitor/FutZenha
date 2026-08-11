import { devices, expect, test } from "@playwright/test";

// A barra de baixo é `fixed` por causa do PWA no iPhone: em standalone o
// `sticky` se soltava durante o quique do rubber-band e ficava por cima dos
// botões (o porquê está no comentário do tab-bar.tsx).
//
// Nenhum browser do CI reproduz aquele bug do WebKit — não é isso que estes
// smokes provam. Eles trancam as três regressões que DÃO para pegar aqui e que
// trariam o bug de volta: voltar para `sticky`, pôr um `transform`/`filter` em
// algum ancestral (que vira bloco contentor do `fixed`) e a reserva do rodapé
// dessincronizar da altura real da nav.

const NAV = { role: "navigation" as const, nome: "Navegação principal" };

// No arquivo inteiro, e não num describe: o perfil do device traz um
// `defaultBrowserType`, e o Playwright recusa isso dentro de grupo. O caso do
// desktop, no fim, muda só a largura na mão — é o que a media query olha.
test.use({ ...devices["Pixel 5"] });

test.describe("celular", () => {
  test("a nav é fixa e continua colada no fim da tela depois de rolar", async ({ page }) => {
    await page.goto("/notificacoes");
    const nav = page.getByRole(NAV.role, { name: NAV.nome });
    await expect(nav).toBeVisible();

    expect(await nav.evaluate((el) => getComputedStyle(el).position)).toBe("fixed");

    // Rolar até o fim é o que separa `fixed` de verdade de um ancestral com
    // transform: com o bloco contentor errado a barra sobe junto com o conteúdo.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const folga = await nav.evaluate(
      (el) => window.innerHeight - el.getBoundingClientRect().bottom,
    );
    expect(folga, "distância entre a nav e o fim da tela").toBeLessThan(1);
  });

  test("a reserva do rodapé bate com a altura real da nav", async ({ page }) => {
    await page.goto("/notificacoes");
    const nav = page.getByRole(NAV.role, { name: NAV.nome });

    // Os dois em px já resolvidos. Ler --tabbar-h com getPropertyValue não
    // serviria: custom property computada devolve o `calc(...)` inteiro, não o
    // valor — e é justamente a igualdade dos dois números que importa.
    const altura = await nav.evaluate((el) => el.getBoundingClientRect().height);
    const reserva = await page.evaluate(() =>
      Number.parseFloat(getComputedStyle(document.body).paddingBottom),
    );
    expect(reserva, "padding-bottom do body vs altura da nav").toBeCloseTo(altura, 1);
  });

  test("cada aba mantém o alvo de toque acima dos 44px", async ({ page }) => {
    await page.goto("/");
    const abas = page.getByRole(NAV.role, { name: NAV.nome }).getByRole("link");
    const quantas = await abas.count();
    expect(quantas).toBeGreaterThan(0);

    // A nav ganhou `h-[var(--tabbar-h)]`: se a conta da variável encolher, é
    // aqui que aparece, antes de virar aba difícil de acertar com o dedo.
    for (let i = 0; i < quantas; i++) {
      const caixa = await abas.nth(i).boundingBox();
      expect(caixa?.height, `aba ${i}`).toBeGreaterThanOrEqual(44);
    }
  });

  test("o botão de enviar avaliação não fica por baixo das abas", async ({ page }) => {
    // O requisito do usuário, escrito como teste. A rodada aberta vem pelos
    // avisos, como no avaliar.spec — nunca por id hardcoded.
    await page.goto("/notificacoes");
    await page.getByRole("link", { name: /Avalie seus companheiros/ }).first().click();
    await expect(page).toHaveURL(/\/avaliar\/\d+$/);

    const nav = page.getByRole(NAV.role, { name: NAV.nome });
    const enviar = page.getByRole("button", {
      name: /Enviar \d+ avaliações|Atualizar avaliação/,
    });

    for (const posicao of ["topo", "fim"] as const) {
      if (posicao === "fim") {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      }
      const caixaEnviar = await enviar.boundingBox();
      const caixaNav = await nav.boundingBox();
      expect(caixaEnviar && caixaNav).toBeTruthy();
      expect(
        caixaEnviar!.y + caixaEnviar!.height,
        `base do botão vs topo das abas, rolagem no ${posicao}`,
      ).toBeLessThanOrEqual(caixaNav!.y + 1);
    }
  });
});

test("no desktop --tabbar-h zera, e a reserva do rodapé zera junto", async ({ page }) => {
  // 1280 é largura de desktop: passa dos 64rem do `lg`, o mesmo ponto em que a
  // TabBar some. A reserva tem de sumir com ela — senão sobra uma faixa vazia
  // no fim de toda página, num lugar onde não há barra nenhuma para cobrir.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/notificacoes");

  await expect(page.getByRole(NAV.role, { name: NAV.nome })).toBeHidden();
  expect(await page.evaluate(() => getComputedStyle(document.body).paddingBottom)).toBe("0px");
});
