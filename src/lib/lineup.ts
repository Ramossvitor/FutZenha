// Quem jogou com quem. Puro de propósito: é a regra que define o universo de
// gente que cada jogador avalia, e ela precisa valer sem banco por perto.

export type EscalacaoRow = {
  gameId: number;
  playerId: number;
  side: "A" | "B";
};

/**
 * Tamanho mínimo do grupo que se avalia: o jogador mais dois companheiros com
 * conta ativa.
 *
 * É a trava contra nota fabricada. Sem ela, bastavam duas contas — uma real e
 * um "jogador" convidado pelo próprio — para montar futs de mentira e subir
 * de 5,0 a 9,3 em cinco rodadas, porque cada fut pesa 1/3 da nota. Com três,
 * o combinado deixa de ser sozinho.
 *
 * A checagem é por lado, não por fut: um time com três contas avalia mesmo
 * que o adversário tenha só duas. O time pequeno joga, conta para placar,
 * artilharia e presença — só não mexe em nota nenhuma.
 */
export const MIN_GRUPO_AVALIACAO = 3;

/**
 * Filtra o mapa de companheiros deixando só quem tem gente suficiente com conta
 * ativa para o grupo fechar `MIN_GRUPO_AVALIACAO`.
 *
 * Puro para poder ser testado sem banco: `comConta` é o conjunto de playerIds
 * com conta ativa, que quem chama busca no Postgres.
 */
export function gruposElegiveis(
  companheiros: Map<number, Set<number>>,
  comConta: Set<number>,
): Set<number> {
  const elegiveis = new Set<number>();
  for (const [playerId, outros] of companheiros) {
    if (!comConta.has(playerId)) continue;
    let pares = 0;
    for (const outro of outros) if (comConta.has(outro)) pares++;
    // +1 porque o próprio jogador conta para o tamanho do grupo.
    if (pares + 1 >= MIN_GRUPO_AVALIACAO) elegiveis.add(playerId);
  }
  return elegiveis;
}

/**
 * Companheiros de cada jogador num fut: todo mundo que dividiu o mesmo lado
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
