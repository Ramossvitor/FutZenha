import { expect, test } from "@playwright/test";
import { criarFut } from "./helpers";

// Smokes do PWA e dos canais de aviso. O ambiente E2E roda SEM chave VAPID por
// design (a ausência é o kill switch, como a do RESEND_API_KEY) — então além do
// manifest e do sw.js, o que se prova aqui é que a UI de push some inteira sem
// as chaves, e que o botão de WhatsApp (que não depende de chave nenhuma)
// aparece para quem está logado.

test("manifest instalável: standalone, ícones e nome", async ({ request }) => {
  const resposta = await request.get("/manifest.webmanifest");
  expect(resposta.status()).toBe(200);
  const manifest = await resposta.json();
  expect(manifest).toMatchObject({ name: "FutZenha", display: "standalone", start_url: "/" });
  expect(manifest.icons.length).toBeGreaterThanOrEqual(4);
});

test("sw.js servido com no-cache — a atualização do handler não pode esperar 24h", async ({
  request,
}) => {
  const resposta = await request.get("/sw.js");
  expect(resposta.status()).toBe(200);
  expect(resposta.headers()["cache-control"]).toContain("no-cache");
  expect(resposta.headers()["content-type"]).toContain("javascript");
});

test("ícones do manifest existem de verdade", async ({ request }) => {
  // A lista sai do próprio manifest, não de uma cópia à mão: com os quatro
  // ícones fixos aqui, os dois `maskable` (que são o ícone da tela de início no
  // Android) podiam sumir sem ninguém notar — o outro smoke só confere
  // `icons.length`, que lê a declaração e não o arquivo.
  // (O apple-icon fica de fora: o App Router o serve em `/apple-icon?<hash>`,
  // sem extensão — ver 03-file-conventions/01-metadata/app-icons.md.)
  const manifest = await (await request.get("/manifest.webmanifest")).json();
  const arquivos = [
    ...manifest.icons.map((i: { src: string }) => i.src),
    "/badge.png", // referenciado pelo public/sw.js, não pelo manifest
  ];
  for (const arquivo of arquivos) {
    expect(`${arquivo} -> ${(await request.get(arquivo)).status()}`).toBe(`${arquivo} -> 200`);
  }
});

test("logado, o fut oferece a convocação pelo WhatsApp", async ({ page }) => {
  const local = `Quadra E2E zap ${Date.now()}`;
  const urlPublica = await criarFut(page, { local });

  await page.goto(urlPublica);
  await expect(page.getByRole("button", { name: "Convocar no WhatsApp" })).toBeVisible();
});

test("sem chave VAPID, nenhuma UI de push aparece", async ({ page }) => {
  // O perfil é onde o painel de push moraria; sem a NEXT_PUBLIC_* no build,
  // o hook reporta sem suporte e a Section nem renderiza.
  await page.goto("/perfil");
  await expect(page.getByText("Meus números")).toBeVisible();
  await expect(page.getByText("Avisos no aparelho")).toBeHidden();
  await expect(page.getByRole("button", { name: "Ativar avisos" })).toBeHidden();
});
