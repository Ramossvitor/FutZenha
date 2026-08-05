// Quem jogou com quem. Puro de propósito: é a regra que define o universo de
// gente que cada jogador avalia, e ela precisa valer sem banco por perto.

export type EscalacaoRow = {
  gameId: number;
  playerId: number;
  side: "A" | "B";
};

/**
 * Companheiros de cada jogador numa pelada: todo mundo que dividiu o mesmo lado
 * com ele em **qualquer** jogo do dia, menos ele mesmo. É a união entre os
 * jogos, deduplicada — quem jogou junto três vezes é avaliado uma vez só.
 *
 * Jogadores que aparecem na escalação sem nenhum companheiro (lado de um homem
 * só, que só existe como dado torto) saem com um conjunto vazio em vez de
 * sumirem do mapa — cabe a quem chama decidir o que fazer com eles.
 */
export function companheirosPorJogador(rows: EscalacaoRow[]): Map<number, Set<number>> {
  const porLado = new Map<string, number[]>();
  for (const row of rows) {
    const chave = `${row.gameId}:${row.side}`;
    const lado = porLado.get(chave);
    if (lado) lado.push(row.playerId);
    else porLado.set(chave, [row.playerId]);
  }

  const companheiros = new Map<number, Set<number>>();
  for (const lado of porLado.values()) {
    for (const playerId of lado) {
      let conjunto = companheiros.get(playerId);
      if (!conjunto) {
        conjunto = new Set<number>();
        companheiros.set(playerId, conjunto);
      }
      for (const outro of lado) {
        if (outro !== playerId) conjunto.add(outro);
      }
    }
  }
  return companheiros;
}
