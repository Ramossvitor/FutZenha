import { cx } from "@/lib/cx";
import { formatSkill } from "@/lib/format";

export type TamanhoNota = "sm" | "md" | "lg" | "xl" | "hero";

const tamanhos: Record<TamanhoNota, string> = {
  sm: "text-[17px]",
  md: "text-[22px]",
  lg: "text-[26px]",
  xl: "text-[38px]",
  hero: "text-[56px] sm:text-[64px]",
};

/**
 * A assinatura visual do produto: o inteiro na cor do texto e a vírgula com a
 * casa decimal em lime.
 *
 * A cor partida é markup, não CSS, porque o que existe é a string "7,8" que o
 * `formatSkill` devolve — não dá para estilizar meio nó de texto.
 *
 * `text-accent-ink` e não `text-accent`: no tema claro o lime cheio dá 1,36:1
 * contra o branco e a vírgula sumiria. No escuro os dois tokens são o mesmo
 * valor, então uma classe serve aos dois temas.
 */
export function Nota({
  valor,
  tamanho = "md",
  className,
}: {
  valor: number;
  tamanho?: TamanhoNota;
  className?: string;
}) {
  const [inteiro, decimal] = formatSkill(valor).split(",");
  return (
    <span className={cx("nota text-fg", tamanhos[tamanho], className)} data-num>
      {inteiro}
      {decimal !== undefined && <span className="text-accent-ink">,{decimal}</span>}
    </span>
  );
}

/**
 * A variação da nota na última rodada.
 *
 * O triângulo é uma forma CSS, não o caractere ▲: o glifo muda de desenho e de
 * alinhamento conforme a fonte instalada, e vinha desalinhando com o número.
 *
 * Atenção ao usar: esta variação é sempre GLOBAL. A consulta que a produz
 * ignora grupo e ano, então ela não pode aparecer ao lado de um seletor de
 * grupo dizendo ou insinuando que é a variação naquele grupo.
 */
export function NotaVariacao({
  valor,
  className,
}: {
  valor: number | null;
  className?: string;
}) {
  if (valor === null || valor === 0) {
    return (
      <span className={cx("font-display text-[11.5px] font-bold text-fg-dim", className)}>—</span>
    );
  }

  const subiu = valor > 0;
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 font-display text-[11.5px] font-bold",
        subiu ? "text-accent-ink" : "text-danger-ink",
        className,
      )}
      data-num
    >
      <span
        aria-hidden
        className={cx(
          "size-0 border-x-[3.5px] border-x-transparent",
          subiu ? "border-b-[5px] border-b-current" : "border-t-[5px] border-t-current",
        )}
      />
      <span className="sr-only">{subiu ? "subiu " : "caiu "}</span>
      {formatSkill(Math.abs(valor))}
    </span>
  );
}
