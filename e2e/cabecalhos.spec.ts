// Os cabeçalhos de segurança, conferidos na resposta de verdade.
//
// Unit e integração não alcançam o `next.config.ts`: quem aplica `headers()` é
// o servidor, então só o E2E contra o build real prova que eles saem. É também
// o único lugar que pega o erro clássico de CSP — a política que quebra a
// página em vez de proteger.

import { expect, test } from "@playwright/test";

const ESPERADOS: Record<string, string | RegExp> = {
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": /camera=\(\)/,
  "strict-transport-security": /max-age=\d{7,}/,
  "content-security-policy": /frame-ancestors 'none'/,
};

test.describe("cabeçalhos de segurança", () => {
  test("saem na resposta do documento", async ({ page }) => {
    const resposta = await page.goto("/login");
    const headers = resposta!.headers();

    for (const [nome, esperado] of Object.entries(ESPERADOS)) {
      expect(headers[nome], `faltou ${nome}`).toBeDefined();
      if (typeof esperado === "string") expect(headers[nome]).toBe(esperado);
      else expect(headers[nome]).toMatch(esperado);
    }
  });

  test("não anuncia o servidor", async ({ page }) => {
    const resposta = await page.goto("/login");
    expect(resposta!.headers()["x-powered-by"]).toBeUndefined();
  });

  // A CSP mais frágil é a que quebra sem ninguém notar: um `script-src` estreito
  // demais mata o bootstrap do Next e a página vira HTML morto. O console limpo
  // é o que separa "protegido" de "quebrado".
  test("a CSP não quebra a página: nenhuma violação no console", async ({ page }) => {
    const violacoes: string[] = [];
    page.on("console", (msg) => {
      const texto = msg.text();
      if (msg.type() === "error" && /Content Security Policy|Refused to/i.test(texto)) {
        violacoes.push(texto);
      }
    });

    // Uma página logada de verdade, e não /login: os specs reusam o
    // storageState do setup, então /login redireciona para a home. O que
    // interessa aqui é uma página com layout completo — nav, service worker e
    // os scripts de bootstrap do Next, que são justamente o que um `script-src`
    // estreito demais mataria. O `main` é o alvo porque atravessa os
    // breakpoints — a nav de baixo é `lg:hidden` e este projeto roda em
    // Desktop Chrome.
    await page.goto("/notificacoes");
    await expect(page.locator("main")).toBeVisible();
    // O sw.js registra a partir do layout — é o caminho que `worker-src` cobre.
    // Espera pelo REGISTRO, e não por um relógio: um `waitForTimeout` fixo ou
    // passa antes de o worker tentar subir (e o teste não prova nada) ou sobra
    // meio segundo em toda execução. O `catch` mantém o teste sobre a CSP: se o
    // registro falhar por outro motivo, quem acusa é o `violacoes` abaixo.
    await page
      .waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 5_000 })
      .catch(() => {});

    expect(violacoes).toEqual([]);
  });

  // O regime de cache do service worker é decisão de produto (o handler de push
  // corrigido não pode esperar 24h) e continua valendo com a regra global por
  // cima: o Next aplica as duas entradas que casam.
  test("a regra global não apagou o no-cache do sw.js", async ({ request }) => {
    const resposta = await request.get("/sw.js");
    expect(resposta.headers()["cache-control"]).toContain("no-store");
    expect(resposta.headers()["x-frame-options"]).toBe("DENY");
  });
});
