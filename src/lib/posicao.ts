// Posição em ranking com empate.
//
// Existe porque `índice + 1` mente quando há empate: dois artilheiros com 7
// gols apareciam como 1º e 2º na home e como 1º e 1º na aba de artilharia, dois
// cliques adiante. A regra é a do esporte — empate divide a posição e o próximo
// pula (1, 1, 3), nunca (1, 1, 2).

/**
 * As posições de uma lista JÁ ORDENADA, na mesma ordem dos itens.
 *
 * `valorDe` extrai o número que decide o empate (gols, nota, presenças). A
 * ordenação é responsabilidade de quem chama — aqui só se comparam vizinhos.
 */
export function posicoes<T>(itens: readonly T[], valorDe: (item: T) => number): number[] {
  const saida: number[] = [];
  for (let i = 0; i < itens.length; i++) {
    if (i > 0 && valorDe(itens[i]) === valorDe(itens[i - 1])) {
      saida.push(saida[i - 1]);
    } else {
      saida.push(i + 1);
    }
  }
  return saida;
}
