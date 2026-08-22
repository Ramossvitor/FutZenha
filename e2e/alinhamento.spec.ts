import { expect, test, type Page } from "@playwright/test";
import { criarFut } from "./helpers";

// A auditoria que originou a LinhaDeCampos achou degraus de ~24px entre inputs
// da mesma linha — um campo com `ajuda` subia em relação ao vizinho sem. Isto
// aqui mede exatamente isso, e não a aparência: snapshot de imagem quebraria a
// cada troca de texto e a cada versão da fonte, o que é ruído demais para uma
// trava que precisa ser levada a sério quando falha.
//
// A varredura é por <form>, e não por [data-linha-de-campos], de propósito: a
// regressão que interessa não é só a linha do primitivo escorregar, é alguém
// voltar a escrever `flex items-end` à mão. Medindo o formulário inteiro, os
// dois casos caem na mesma asserção. (A trava contra a linha à mão também
// existe no fonte, em linha-de-campos.test.ts — esta aqui é a que vê a tela.)
//
// O único submit é o `criarFut` de cada teste — um fut por viewport, dois no
// total. Ele é o preço de ter uma `/gerenciar` de que este spec é organizador:
// as outras cinco rotas se visitam sem escrever nada, esta não existe sem um
// fut próprio. Com `workers: 1` e banco compartilhado, e com `alinhamento`
// primeiro na ordem alfabética, todo spec posterior roda com esses dois futs no
// banco — o que é seguro porque `dataFutura(30)` os põe bem depois da "próxima
// quarta" do seed, fora do posto de "Próximo fut" que os outros disputam (ver o
// contrato do helper). Nenhuma outra rota daqui envia formulário.

const CELULAR = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };

/** Quanto dois controles podem divergir e ainda contar como alinhados. */
const TOLERANCIA_PX = 1;

type Caixa = { x: number; y: number; width: number; height: number };

// Checkbox e rádio ficam de fora: eles têm 16px numa faixa de 40, e a promessa
// sobre eles é outra (o centro, conferido mais abaixo).
const CONTROLES =
  "input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea, button";

async function caixas(page: Page, escopo: number, seletor: string): Promise<Caixa[]> {
  const alvos = await page.locator("form").nth(escopo).locator(seletor).all();
  const encontradas: Caixa[] = [];
  for (const alvo of alvos) {
    const caixa = await alvo.boundingBox();
    if (caixa && caixa.height > 0) encontradas.push(caixa);
  }
  return encontradas;
}

/**
 * Agrupa em faixas visuais: dois controles são da mesma faixa quando as alturas
 * se SOBREPÕEM, nem que seja por um pixel.
 *
 * Por sobreposição, e não por proximidade dos topos: um limiar de N pixels
 * deixaria passar exatamente o defeito que este arquivo existe para pegar — o
 * degrau de ~24px que a `ajuda` provocava seria grande demais para o limiar,
 * os dois inputs cairiam em "faixas" diferentes e a comparação nunca
 * aconteceria. O teste ficaria verde por não ter olhado.
 *
 * No celular, onde a linha vira pilha, controles consecutivos ficam separados
 * pelo gap mais o rótulo — não se sobrepõem, e cada um é a sua própria faixa.
 */
function agruparPorFaixa(todas: Caixa[]): Caixa[][] {
  const faixas: Caixa[][] = [];
  let base = -Infinity;

  for (const caixa of [...todas].sort((a, b) => a.y - b.y)) {
    if (caixa.y < base && faixas.length > 0) {
      faixas[faixas.length - 1].push(caixa);
      base = Math.max(base, caixa.y + caixa.height);
    } else {
      faixas.push([caixa]);
      base = caixa.y + caixa.height;
    }
  }

  return faixas;
}

/** Confere um formulário e devolve quantas comparações reais fez. */
async function conferirFormulario(page: Page, rota: string, i: number): Promise<number> {
  const controles = await caixas(page, i, CONTROLES);
  let comparacoes = 0;

  for (const faixa of agruparPorFaixa(controles)) {
    if (faixa.length < 2) continue;
    comparacoes += faixa.length - 1;
    const bases = faixa.map((c) => c.y + c.height);
    expect(
      Math.max(...bases) - Math.min(...bases),
      `${rota}: controles da mesma faixa com bases diferentes (form ${i + 1})`,
    ).toBeLessThanOrEqual(TOLERANCIA_PX);
  }

  // O checkbox tem 16px e mora numa faixa de 40: o que se promete dele não é a
  // base junto com os inputs, é o CENTRO no centro da faixa do controle.
  //
  // Só vale quando ele divide a faixa com algum controle. Empilhado — que é o
  // que a linha faz no celular — o checkbox fica legitimamente abaixo, e cobrar
  // alinhamento aí seria cobrar que a pilha não fosse pilha.
  for (const caixa of await caixas(page, i, "input[type=checkbox]")) {
    const vizinhos = controles.filter(
      (c) => c.y < caixa.y + caixa.height && caixa.y < c.y + c.height,
    );
    if (vizinhos.length === 0) continue;

    comparacoes++;
    const centro = caixa.y + caixa.height / 2;
    const centroDaFaixa =
      (Math.min(...vizinhos.map((c) => c.y)) + Math.max(...vizinhos.map((c) => c.y + c.height))) / 2;
    expect(
      Math.abs(centro - centroDaFaixa),
      `${rota}: checkbox descentrado na faixa do controle (form ${i + 1})`,
    ).toBeLessThanOrEqual(TOLERANCIA_PX);
  }

  return comparacoes;
}

async function conferirSemRolagemLateral(page: Page, rota: string): Promise<void> {
  const sobra = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(sobra, `${rota}: a página rola de lado`).toBeLessThanOrEqual(0);
}

for (const [nome, viewport] of [
  ["celular", CELULAR],
  ["desktop", DESKTOP],
] as const) {
  test(`formulários alinhados no ${nome}`, async ({ page }) => {
    await page.setViewportSize(viewport);

    const fut = await criarFut(page, { local: `Alinhamento ${nome}`, vagas: 10 });

    const rotas = [
      "/futs/novo",
      `${fut}/gerenciar`,
      "/grupos",
      // `du` é o admin da plataforma do seed, e o storageState que todos os
      // specs usam já atravessa o requirePlatformAdmin — nenhuma fixture nova.
      "/admin/jogadores",
      "/admin/futs",
      "/admin/zenhas",
    ];

    let comparacoes = 0;
    for (const rota of rotas) {
      await page.goto(rota);
      await expect(page.locator("main")).toBeVisible();

      const forms = await page.locator("form").count();
      for (let i = 0; i < forms; i++) comparacoes += await conferirFormulario(page, rota, i);

      if (nome === "celular") await conferirSemRolagemLateral(page, rota);
    }

    // Sem isto o teste passaria por vazio no dia em que um seletor mudasse:
    // seis rotas sem nada para medir, e verde do mesmo jeito.
    expect(comparacoes, "nenhum par de controles foi comparado").toBeGreaterThan(10);
  });
}
