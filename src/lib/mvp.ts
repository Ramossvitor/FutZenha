// Regra de apuração do MVP do fut. Pura de propósito, como a votação de
// exclusão (src/lib/votacao.ts): é a parte em que errar significa dar o título
// a quem não venceu — e é a mesma função que roda no fechamento da rodada e no
// ranking, então as duas telas nunca discordam.

// Piso de publicação: com um voto contado só, o resultado É o voto de uma
// pessoa identificável — quem enviou é público durante a rodada (a lista de
// "quem já avaliou" e a cobrança no zap). Mesmo racional do
// MIN_AVALIACOES_PARA_DENUNCIAR (src/lib/regras.ts): abaixo de dois,
// publicar é apontar o dedo.
export const MIN_VOTOS_PARA_MVP = 2;

export type CandidatoApurado = {
  playerId: number;
  /** Votos de melhor em campo recebidos na rodada. */
  votos: number;
  /**
   * Média das meias-estrelas (1..10) recebidas na própria rodada, só das
   * avaliações não descartadas. null = jogou mas não recebeu avaliação
   * (o lado dele não atingiu o grupo mínimo) — perde o desempate de qualquer
   * média real.
   */
  mediaMeias: number | null;
};

/**
 * Vencedores da rodada: os mais votados; empate decidido pela maior média de
 * estrelas recebidas na própria rodada; persistindo o empate, o título é
 * dividido — todos contam no ranking. Vazio = ninguém votou (fut sem MVP) ou
 * total de votos contados abaixo de MIN_VOTOS_PARA_MVP (sigilo do voto).
 *
 * O resultado é sempre derivado do que sobrou: uma denúncia aceita que
 * descarta avaliação muda a média e pode reordenar um desempate passado, do
 * mesmo jeito que o replay reescreve a nota (ver aplicarReplay).
 */
export function apurarMvp(candidatos: CandidatoApurado[]): number[] {
  const comVoto = candidatos.filter((c) => c.votos > 0);
  if (comVoto.length === 0) return [];

  const totalVotos = comVoto.reduce((soma, c) => soma + c.votos, 0);
  if (totalVotos < MIN_VOTOS_PARA_MVP) return [];

  const maisVotos = Math.max(...comVoto.map((c) => c.votos));
  const maisVotados = comVoto.filter((c) => c.votos === maisVotos);

  // `?? -Infinity`: sem média, qualquer média real vence; todos sem média
  // empatam entre si e dividem.
  const melhorMedia = Math.max(...maisVotados.map((c) => c.mediaMeias ?? -Infinity));
  return maisVotados
    .filter((c) => (c.mediaMeias ?? -Infinity) === melhorMedia)
    .map((c) => c.playerId)
    .sort((a, b) => a - b);
}

/**
 * Soma os títulos por jogador sobre os vencedores de cada rodada. Título
 * dividido conta inteiro para todos os empatados — meio MVP não existe.
 */
export function contarTitulos(
  vencedoresPorRodada: ReadonlyArray<readonly number[]>,
): Map<number, number> {
  const titulos = new Map<number, number>();
  for (const vencedores of vencedoresPorRodada) {
    for (const playerId of vencedores) {
      titulos.set(playerId, (titulos.get(playerId) ?? 0) + 1);
    }
  }
  return titulos;
}
