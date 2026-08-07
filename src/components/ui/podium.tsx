import { cx } from "@/lib/cx";

export type ItemDoPodio = {
  posicao: number;
  nome: string;
  valor: number;
};

// Alturas diferentes por posição, como o pódio de verdade. O 1º fica no meio.
const ORDEM_VISUAL = [1, 0, 2];

/**
 * O pódio de três da artilharia.
 *
 * `posicao` vem de fora e não do índice, porque empate divide a posição: dois
 * artilheiros com 7 gols são 1º e 1º, e o próximo é 3º. Usar `índice + 1` aqui
 * faria a home discordar da aba de artilharia, a dois cliques de distância.
 */
export function Podium({ itens, className }: { itens: ItemDoPodio[]; className?: string }) {
  if (itens.length === 0) return null;

  const ordenados = ORDEM_VISUAL.filter((i) => i < itens.length).map((i) => ({
    item: itens[i],
    lugar: i,
  }));

  return (
    <ol className={cx("flex items-end gap-2", className)}>
      {ordenados.map(({ item, lugar }) => {
        const primeiro = lugar === 0;
        return (
          <li
            key={`${item.nome}-${lugar}`}
            className={cx(
              "flex flex-1 flex-col items-center gap-1 rounded-card border px-2 py-3",
              primeiro
                ? "border-accent-edge bg-accent"
                : "border-line bg-surface",
              lugar === 0 ? "h-[124px]" : lugar === 1 ? "h-[104px]" : "h-[92px]",
            )}
          >
            <span
              className={cx(
                "font-display text-[10px] font-extrabold tracking-[.1em]",
                primeiro ? "text-on-accent/70" : "text-fg-4",
              )}
            >
              {item.posicao}º
            </span>
            <span
              className={cx(
                "nota",
                primeiro ? "text-[36px] text-on-accent" : "text-[26px] text-fg",
              )}
              data-num
            >
              {item.valor}
            </span>
            <span
              className={cx(
                "line-clamp-2 text-center font-display text-[12px] leading-[1.2] font-bold",
                primeiro ? "text-on-accent/80" : "text-fg-2",
              )}
            >
              {item.nome}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
