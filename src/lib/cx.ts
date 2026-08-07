/**
 * Junta classes, descartando o que for falso.
 *
 * Três linhas em vez de uma dependência: o projeto não tem clsx nem
 * tailwind-merge, e o que se faz aqui é sempre `cx(base, cond && extra)`.
 *
 * Sem resolução de conflito de propósito — `cx("p-2", "p-4")` devolve as duas
 * e quem vence é a ordem no CSS, não a ordem aqui. Onde a variante precisa
 * mesmo trocar um valor, o componente escolhe a string inteira em vez de
 * empilhar duas.
 */
export function cx(...partes: (string | false | null | undefined)[]): string {
  return partes.filter(Boolean).join(" ");
}
