import { expect, test, type Page } from "@playwright/test";
import { criarFut } from "./helpers";

// A camada de movimento não tem como ser testada em unit: o projeto não tem
// jsdom, e a parte que dá para isolar (a geometria do ponto) já tem teste ao
// lado do módulo. O que sobra é o comportamento no browser de verdade, e é o
// que estes smokes trancam.

const CAMADA = "[data-comemoracao]";

/** As cinco propriedades que viram bloco contentor de um `position: fixed`. */
const CONTENTORAS = ["transform", "filter", "backdropFilter", "willChange", "contain"] as const;

async function ancestraisSujosDaNav(page: Page) {
  return page.evaluate((props) => {
    const nav = document.querySelector("nav[aria-label='Navegação principal']");
    const sujos: string[] = [];
    for (let el = nav?.parentElement; el; el = el.parentElement) {
      const cs = getComputedStyle(el);
      for (const p of props) {
        const v = cs[p as never] as unknown as string;
        if (v && v !== "none" && v !== "auto" && v !== "normal") {
          sujos.push(`${el.tagName}.${el.className || "(sem classe)"} → ${p}: ${v}`);
        }
      }
    }
    return sujos;
  }, CONTENTORAS as unknown as string[]);
}

test("a bola comemora ao confirmar presença, e some sozinha", async ({ page }) => {
  const url = await criarFut(page, { local: `Comemoração E2E ${Date.now()}`, vagas: 10 });
  await page.goto(url);

  await page.getByRole("button", { name: "Vou", exact: true }).click();

  // Este é o caminho difícil: em /fut/[id] o próprio botão "Vou" some quando a
  // action termina. Se a comemoração dependesse do `pending` caindo com o botão
  // vivo, nada apareceria aqui.
  const camada = page.locator(CAMADA);
  await expect(camada).toBeAttached();

  // E precisa ir embora: camada que vaza nó no <body> vira uma pilha deles
  // depois de uma tarde de uso.
  await expect(camada).toHaveCount(0, { timeout: 3000 });
});

test("a camada não é ancestral da TabBar nem rouba o clique", async ({ page }) => {
  const url = await criarFut(page, { local: `Comemoração E2E ${Date.now()}`, vagas: 10 });
  await page.goto(url);

  await page.getByRole("button", { name: "Vou", exact: true }).click();
  await expect(page.locator(CAMADA)).toBeAttached();

  // A regressão que este assert existe para pegar aparece EXATAMENTE aqui, com a
  // camada no ar: ela se centraliza com um `transform`, e se um dia alguém a
  // montar dentro do <div> que contém a nav, a TabBar volta a se soltar no
  // quique do iOS. Ver o comentário do tab-bar.tsx e o do layout.tsx.
  expect(await ancestraisSujosDaNav(page), "ancestrais da nav durante a comemoração").toEqual([]);

  // pointer-events: none, na prática — o clique seguinte tem que passar.
  await page.getByRole("button", { name: "Fora", exact: true }).click();
  await expect(page.getByRole("button", { name: "Vou", exact: true })).toBeVisible();
});

/** Luminância relativa de um `rgb(...)` computado, pela fórmula da WCAG. */
function luminancia(cor: string) {
  const [r, g, b] = (cor.match(/\d+(\.\d+)?/g) ?? ["0", "0", "0"]).slice(0, 3).map((n) => {
    const c = Number(n) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contraste(a: string, b: string) {
  const [claro, escuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (claro + 0.05) / (escuro + 0.05);
}

// `toBeAttached` passa para uma bola pintada exatamente da cor do que está
// embaixo dela, e foi essa folga que deixou passar a versão em que o tom saía da
// variante do botão: no tema escuro `accent-ink` e `accent` são o mesmo #CDFF3A,
// e `on-accent` (#070908) é quase a surface (#101413). Nos dois temas, então, e
// olhando a cor de verdade.
for (const tema of ["light", "dark"] as const) {
  test(`a bola aparece contra o fundo no tema ${tema}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: tema });
    const url = await criarFut(page, { local: `Comemoração E2E ${Date.now()}`, vagas: 10 });
    await page.goto(url);

    await page.getByRole("button", { name: "Vou", exact: true }).click();
    const bola = page.locator(`${CAMADA} svg`);
    await expect(bola).toBeAttached();

    // O fundo é lido no ponto onde a bola está, e não no <body>: em /fut/[id]
    // ela cai na surface, e na home cairia em cima do próprio botão lime.
    const { tinta, fundo } = await bola.evaluate((svg) => {
      const r = svg.getBoundingClientRect();
      const tinta = getComputedStyle(svg).color;
      const atras = document
        .elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2)
        .find((el) => {
          const bg = getComputedStyle(el).backgroundColor;
          return bg && !bg.startsWith("rgba(0, 0, 0, 0)") && !el.closest("[data-comemoracao]");
        });
      return { tinta, fundo: getComputedStyle(atras ?? document.body).backgroundColor };
    });

    // 3:1 é o piso de componente gráfico não-textual da WCAG — o mesmo que a
    // borda dos coletes carrega em team-colors.
    expect(contraste(tinta, fundo), `bola ${tinta} sobre ${fundo}`).toBeGreaterThan(3);
  });
}

test.describe("com o movimento desligado", () => {
  test("a escolha em /perfil impede a comemoração", async ({ page, context }) => {
    const url = await criarFut(page, { local: `Comemoração E2E ${Date.now()}`, vagas: 10 });
    await context.addCookies([
      { name: "futzenha_movimento", value: "reduzido", url: "http://localhost:3000" },
    ]);
    await page.goto(url);
    expect(await page.evaluate(() => document.documentElement.dataset.motion)).toBe("reduzido");

    await page.getByRole("button", { name: "Vou", exact: true }).click();
    // A lista precisa ter respondido antes de afirmar que nada apareceu — senão
    // o teste passaria por ter olhado cedo demais.
    await expect(page.getByText("Na lista · 1")).toBeVisible();
    await expect(page.locator(CAMADA)).toHaveCount(0);
  });

  test("o prefers-reduced-motion do sistema também impede", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const url = await criarFut(page, { local: `Comemoração E2E ${Date.now()}`, vagas: 10 });
    await page.goto(url);

    await page.getByRole("button", { name: "Vou", exact: true }).click();
    await expect(page.getByText("Na lista · 1")).toBeVisible();
    await expect(page.locator(CAMADA)).toHaveCount(0);
  });

  test("nada congela no meio do keyframe", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");

    // Antes, o desligamento era `animation-duration: .01ms`, que deixava o
    // elemento parado num quadro qualquer — e o pulso do prazo urgente
    // congelava a 35% de opacidade justamente quando ele é o texto mais
    // importante da tela. Hoje é `animation: none`, e a regra é que o estilo
    // estático já seja o estado final. Este assert é o que autoriza a exceção
    // `.animate-urg { opacity: 1 !important }` a não existir mais.
    const opacidades = await page.evaluate(() =>
      [...document.querySelectorAll(".animate-urg, .animate-chegada, .animate-realce")].map(
        (el) => getComputedStyle(el).opacity,
      ),
    );
    for (const o of opacidades) expect(Number(o)).toBe(1);
  });
});
