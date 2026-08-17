// A matemática do puxar-para-atualizar, sem DOM e sem React — que é a única
// parte testável aqui: o projeto não tem jsdom, e `**/*.tsx` está fora da
// cobertura por decisão registrada no vitest.config.mts. O gesto em si mora no
// puxar-para-atualizar.tsx ao lado. Mesma divisão do comemoracao-ponto.ts.

/**
 * Quanto o dedo precisa andar antes de decidirmos de quem é o gesto.
 *
 * Sem esta folga, o primeiro pixel de qualquer toque decidiria o eixo, e um
 * deslize horizontal que começa 1px torto viraria puxada.
 */
export const ATIVACAO = 8;

/** Deslocamento visível máximo da pílula: daqui não passa, por mais que se puxe. */
export const TETO = 120;

/** Deslocamento visível a partir do qual soltar dispara a atualização. */
export const LIMIAR = 64;

/**
 * A curva de resistência: o dedo anda mais do que a pílula, e a pílula satura
 * no TETO.
 *
 * Exponencial, e não linear com clamp, porque é o que dá a sensação de elástico
 * — o começo acompanha o dedo quase 1:1 e vai endurecendo. Com estes números
 * são ~93px de dedo para armar, dentro da faixa do gesto nativo do iOS.
 *
 * Puxada para cima não existe: devolve 0 e deixa a rolagem normal acontecer.
 */
export function resistencia(dyBruto: number): number {
  if (dyBruto <= 0) return 0;
  return TETO * (1 - Math.exp(-dyBruto / TETO));
}

/** Soltar agora atualiza? */
export function armado(deslocamento: number): boolean {
  return deslocamento >= LIMIAR;
}

/**
 * O gesto é nosso?
 *
 * Só para baixo, e só quando a componente vertical domina. As duas condições
 * são necessárias: `/rankings` tem uma faixa de abas `overflow-x-auto` e uma
 * tabela idem — deslizar lateralmente sobre elas não pode virar atualização.
 */
export function ehPuxadaParaBaixo(dx: number, dy: number): boolean {
  return dy > 0 && Math.abs(dy) > Math.abs(dx);
}

/**
 * A pílula nasce transparente e chega opaca no ponto em que arma — assim a
 * própria opacidade avisa que falta pouco, sem precisar de rótulo.
 */
export function opacidade(deslocamento: number): number {
  if (deslocamento <= 0) return 0;
  return Math.min(1, deslocamento / LIMIAR);
}
