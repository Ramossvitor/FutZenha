// Como as estrelas recebidas são mostradas sem entregar quem deu cada uma.
//
// O problema não é óbvio: `ratings.id` é serial, então ordenar por id (ou
// expor o id na tela) revela a ordem em que as pessoas enviaram. Num grupo
// pequeno, "quem avaliou primeiro" é informação suficiente para deduzir.

export type AvaliacaoAnonima<T> = T & { ratingId: number; halfStars: number };

/**
 * Hash multiplicativo de Knuth. Só precisa embaralhar de forma estável — a
 * mesma avaliação cai sempre na mesma posição, entre um render e outro, sem
 * que a posição diga nada sobre quando ela foi enviada.
 */
function embaralhar(ratingId: number): number {
  return Math.imul(ratingId, 2654435761) >>> 0;
}

/**
 * Ordena as avaliações recebidas por nota (maior primeiro) e desempata pelo
 * hash — nunca por id nem por data. Estável: chamar duas vezes dá a mesma
 * ordem, o que é o que permite identificar uma avaliação pela posição na lista
 * em vez de pelo id.
 */
export function ordenarAnonimo<T>(avaliacoes: AvaliacaoAnonima<T>[]): AvaliacaoAnonima<T>[] {
  return [...avaliacoes].sort(
    (a, b) => b.halfStars - a.halfStars || embaralhar(a.ratingId) - embaralhar(b.ratingId),
  );
}
