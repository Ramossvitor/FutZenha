import { expect, type Page } from "@playwright/test";

/**
 * Arrasta um dedo pela tela, de verdade.
 *
 * Via CDP porque `page.touchscreen` só sabe dar `tap` — não existe arrasto na
 * API pública. E eventos sintetizados por `page.evaluate` não serviriam: eles
 * chegam com `isTrusted: false` e `cancelable: false`, e é justamente o
 * `evento.cancelable` que o puxar-para-atualizar.tsx consulta antes de segurar a
 * rolagem. Chromium-only, que é o único projeto do playwright.config.
 */
export async function arrastarComODedo(
  page: Page,
  de: { x: number; y: number },
  ate: { x: number; y: number },
  passos = 12,
): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: de.x, y: de.y }],
    });
    // Em passos, e não num salto: o componente decide o eixo do gesto nos
    // primeiros 8px (ATIVACAO), então um único touchMove pularia a decisão.
    for (let i = 1; i <= passos; i++) {
      const fracao = i / passos;
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          {
            x: de.x + (ate.x - de.x) * fracao,
            y: de.y + (ate.y - de.y) * fracao,
          },
        ],
      });
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } finally {
    await cdp.detach();
  }
}

/**
 * Data futura em ISO (yyyy-mm-dd), bem depois da "próximo fut" do seed
 * (quarta que vem): os futs criados pelos specs não podem roubar o posto de
 * "Próximo fut" da home, que o lista-espera.spec usa para achar o fut
 * lotada do seed.
 */
export function dataFutura(dias = 30): string {
  return new Date(Date.now() + dias * 86_400_000).toISOString().slice(0, 10);
}

/** Loga pelo formulário real de /login e espera aterrissar logado. */
export async function loginPelaUI(page: Page, usuario: string, senha = "senha123"): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Usuário").fill(usuario);
  await page.getByLabel("Senha").fill(senha);
  await page.getByRole("button", { name: "Entrar" }).click();
  // O "Sair" da lateral só existe logado — é o marcador de sessão estabelecida.
  await expect(page.getByRole("button", { name: "Sair" })).toBeVisible();
}

/**
 * Cria um fut por /futs/novo e devolve a URL pública (/fut/[id]),
 * descoberta pelo redirect da própria UI — nunca por id hardcoded.
 */
export async function criarFut(
  page: Page,
  opcoes: { local: string; vagas?: number; dias?: number },
): Promise<string> {
  await page.goto("/futs/novo");
  await page.getByLabel("Data").fill(dataFutura(opcoes.dias ?? 30));
  await page.getByLabel("Local").fill(opcoes.local);
  if (opcoes.vagas !== undefined) {
    await page.getByLabel("Vagas").fill(String(opcoes.vagas));
  }
  await page.getByRole("button", { name: "Criar fut" }).click();
  await expect(page).toHaveURL(/\/fut\/\d+\/gerenciar$/);
  await expect(page.getByText("Você organiza este fut.")).toBeVisible();
  return page.url().replace(/\/gerenciar$/, "");
}
