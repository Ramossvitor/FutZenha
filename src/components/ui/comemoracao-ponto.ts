// A parte da comemoração que não precisa de DOM — e que por isso é a única que
// dá para testar aqui: o projeto não tem jsdom, e `**/*.tsx` está fora da
// cobertura por decisão registrada no vitest.config.mts. O resto mora no
// comemoracao.tsx ao lado.
//
// Arquivo separado, e não `comemoracao.ts` junto do `.tsx`: os dois nomes
// colidem na resolução de módulo e o `.ts` sombreia o `.tsx` em silêncio.

/**
 * O canal entre o botão que terminou e a camada que desenha.
 *
 * Evento no `window`, e não contexto do React, porque o disparo acontece no
 * cleanup de um componente que está sendo DESMONTADO: em /fut/[id] confirmar
 * presença remove o próprio botão da árvore. Um setState de contexto nesse
 * ponto seria um update durante o commit de desmontagem.
 */
export const EVENTO_COMEMORACAO = "futzenha:comemoracao";

/** Sobre o lime cheio do botão "Vou", a bola precisa da tinta escura. */
export type TomDaComemoracao = "padrao" | "sobre-accent";

export type Comemoracao = { x: number; y: number; tom: TomDaComemoracao };

export type CaixaDoAlvo = { left: number; top: number; width: number; height: number };
export type Viewport = { width: number; height: number };

/**
 * Onde a bola toca: o centro do alvo, preso dentro da viewport com a folga do
 * raio.
 *
 * A caixa vem de um `getBoundingClientRect()` tirado ANTES de a action terminar,
 * porque depois dela o botão pode não existir mais. Isso significa que ela pode
 * chegar desatualizada — a lista cresceu, a página rolou — e é por isso que o
 * clamp existe: uma comemoração meio fora da tela é pior do que uma comemoração
 * alguns pixels fora do lugar.
 *
 * Sem alvo (submit por teclado sem foco no botão, ou rect zerada), o centro da
 * viewport é o palpite honesto.
 */
export function pontoDaComemoracao(
  caixa: CaixaDoAlvo | null,
  viewport: Viewport,
  raio = 22,
): { x: number; y: number } {
  const centro = { x: viewport.width / 2, y: viewport.height / 2 };
  if (!caixa || caixa.width <= 0 || caixa.height <= 0) return centro;

  // Viewport estreita demais para caber a folga dos dois lados: o clamp
  // inverteria os limites e jogaria a bola para o canto. Centro, e pronto.
  const prender = (valor: number, limite: number) =>
    limite < raio * 2 ? limite / 2 : Math.min(Math.max(valor, raio), limite - raio);

  return {
    x: prender(caixa.left + caixa.width / 2, viewport.width),
    y: prender(caixa.top + caixa.height / 2, viewport.height),
  };
}
