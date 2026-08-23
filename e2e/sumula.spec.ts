import { expect, test } from "@playwright/test";
import { criarFut } from "./helpers";

// A súmula ao vivo, do sorteio ao encerramento: iniciar o jogo, lançar gol com
// autor e gol contra, desfazer com a confirmação de dois toques, o bloqueio do
// encerramento com jogo aberto e a liberação depois de finalizar.
//
// Roda em viewport mobile e tema escuro de propósito: o painel é uma
// ferramenta de beira de quadra — celular na mão — e é assim que ele precisa
// provar que funciona. O spec anexa um print do painel ao relatório do
// Playwright (ver o passo do screenshot).
//
// Mesma tática do encerrar.spec: fut criado PELO spec, presenças marcadas em
// jogadores que o seed nunca dá conta — o fut do seed fica em paz e o
// encerramento daqui não abre rodada de avaliação que desestabilize o
// avaliar.spec na segunda passada.
const SEM_CONTA = ["Diego Ferreira", "Felipe Costa", "Igor Santana", "Gabriel Martins"];

test.use({ viewport: { width: 390, height: 844 }, colorScheme: "dark" });

test("súmula ao vivo: iniciar, lançar, desfazer, finalizar e encerrar", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const local = `Súmula E2E ${Date.now()}`;
  const urlPublica = await criarFut(page, { local });

  await page.goto(urlPublica);
  await page.getByRole("button", { name: "Vou", exact: true }).click();
  await expect(page.getByText("Na lista · 1")).toBeVisible();

  await page.getByRole("link", { name: "Gerenciar" }).click();
  await expect(page).toHaveURL(/\/gerenciar$/);
  for (const nome of SEM_CONTA) {
    await page.getByLabel("Buscar jogador").fill(nome);
    const linha = page.getByRole("listitem").filter({ hasText: nome });
    await linha.getByRole("button", { name: "Vai", exact: true }).click();
    await expect(linha.getByText("vai", { exact: true })).toBeVisible();
  }
  await page.getByRole("button", { name: "Fechar lista e sortear" }).click();
  await expect(page.getByText("Times sorteados")).toBeVisible();

  // O sorteio libera o caminho do painel.
  await page.getByRole("link", { name: "Súmula ao vivo" }).click();
  await expect(page).toHaveURL(/\/sumula$/);

  // Abre o jogo — os selects já vêm com os dois primeiros times.
  await page.getByRole("button", { name: "Iniciar jogo" }).click();
  // Ancorado no início: o selo do jogo aberto é o único texto que COMEÇA com
  // "em andamento". Os textos de ajuda do painel também citam a expressão no
  // meio da frase, e um locator solto colidia com eles.
  await expect(page.getByText(/^em andamento/)).toBeVisible();
  await expect(page.getByText("0 × 0")).toBeVisible();

  // Gol contra / sem autor: soma no placar sem creditar artilharia — e é o
  // caminho determinístico, porque o sorteio distribui os nomes ao acaso.
  await page.getByRole("button", { name: /^Gol do / }).first().click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  await sheet.getByRole("button", { name: "Gol contra / sem autor" }).click();
  // O sheet só fecha quando o gol ATERRISSA — o fechamento é a confirmação.
  await expect(sheet).toBeHidden();
  await expect(page.getByText("1 × 0")).toBeVisible();

  // Gol com autor: o primeiro jogador da escalação do mesmo lado.
  await page.getByRole("button", { name: /^Gol do / }).first().click();
  await expect(sheet).toBeVisible();
  await sheet.locator("form button").first().click();
  await expect(sheet).toBeHidden();
  await expect(page.getByText("2 × 0")).toBeVisible();

  // Desfazer é dois toques: arma ("Confirma?") e só então submete. O gol
  // desfeito fica riscado na lista, com o rastro de quem desfez.
  await expect(page.getByRole("button", { name: "Desfazer" })).toHaveCount(2);
  await page.getByRole("button", { name: "Desfazer" }).first().click();
  await page.getByRole("button", { name: "Confirma?" }).click();
  await expect(page.getByText("1 × 0")).toBeVisible();
  await expect(page.getByText(/desfeito por/)).toBeVisible();

  // Trocar de lado no meio do jogo: também dois toques, e a confirmação diz o
  // destino. A troca entra na mesma linha do tempo dos gols, sem Desfazer —
  // voltar é trocar de novo.
  await page.getByRole("button", { name: "Trocar de lado" }).first().click();
  await page.getByRole("button", { name: /^Vai para o / }).click();
  await expect(page.getByText(/foi para o /)).toBeVisible();
  await expect(page.getByText(/^saiu do /)).toBeVisible();

  // O print do painel no meio do jogo — mobile, tema escuro, com placar,
  // botões gigantes, lançamento ativo e lançamento desfeito.
  //
  // Vai como anexo do relatório, não como arquivo no repositório: gravar em
  // docs/ fazia todo `npm run e2e` deixar um arquivo não rastreado na árvore, e
  // o gate de qualidade não pode sujar o working tree. Para pegar o PNG:
  // `npx playwright test sumula --reporter=html` e procurar em
  // playwright-report/data/ (a pasta é ignorada pelo git).
  await testInfo.attach("painel-mobile-escuro", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });

  // Encerrar o fut com jogo aberto é recusado — o erro aponta o caminho.
  await page.goto(`${urlPublica}/gerenciar/encerrar`);
  await page.getByRole("button", { name: "Encerrar o fut" }).click();
  await expect(page.getByText(/jogo com súmula em andamento/)).toBeVisible();

  // Finalizar também é dois toques. Fechado o jogo, o painel volta ao
  // "Próximo jogo" com o placar arquivado em "Jogos de hoje".
  await page.goto(`${urlPublica}/sumula`);
  await page.getByRole("button", { name: "Finalizar jogo" }).click();
  await page.getByRole("button", { name: "Confirmar o fim do jogo?" }).click();
  await expect(page.getByRole("button", { name: "Iniciar jogo" })).toBeVisible();
  await expect(page.getByText("Jogos de hoje")).toBeVisible();
  await expect(page.getByText("1 × 0")).toBeVisible();

  // A página pública mostra o resultado; sem jogo aberto, nada de badge.
  await page.goto(urlPublica);
  await expect(page.getByText("1 × 0")).toBeVisible();
  await expect(page.getByText("Gol contra / sem autor")).toBeVisible();
  await expect(page.getByText("em andamento")).toBeHidden();

  // E agora o encerramento passa.
  await page.goto(`${urlPublica}/gerenciar/encerrar`);
  await page.getByRole("button", { name: "Encerrar o fut" }).click();
  await expect(page).toHaveURL(/\/gerenciar$/);
  await expect(page.getByText("Encerrado", { exact: true })).toBeVisible();
});
