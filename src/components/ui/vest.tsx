import type { CSSProperties } from "react";
import { cx } from "@/lib/cx";

export type TamanhoColete = "sm" | "md" | "lg";

// Proporção de camisa: um pouco mais alto que largo.
const tamanhos: Record<TamanhoColete, string> = {
  sm: "h-[11px] w-[9px]",
  md: "h-[16px] w-[13px]",
  lg: "h-[19px] w-[16px]",
};

/**
 * O retângulo de cor do colete.
 *
 * `cor` é a coluna `teams.cor`: hex = chip sólido naquela cor; `null` = "sem
 * colete", chip vazado de borda tracejada (o time que joga sem camisa por
 * cima); `undefined` = não se sabe o time — gol cujo lado ninguém gravou —,
 * chip neutro. Três estados de propósito: o vazado é informação ("é o time
 * sem colete"), o neutro é a ausência dela, e desenhar os dois iguais faria
 * gol sem lado parecer gol do time sem colete.
 *
 * `aria-hidden` sempre: o nome do time vem escrito ao lado, e cor não pode ser
 * o único portador de informação — nem para quem não enxerga, nem para os 8%
 * de daltônicos que não distinguem o time Verde do Vermelho.
 */
export function VestChip({
  cor,
  tamanho = "md",
  className,
}: {
  cor: string | null | undefined;
  tamanho?: TamanhoColete;
  className?: string;
}) {
  const pintura = pinturaDoColete(cor);
  return (
    <span
      aria-hidden
      style={pintura.style}
      className={cx(
        "inline-block shrink-0 rounded-selo border",
        tamanhos[tamanho],
        pintura.className,
        className,
      )}
    />
  );
}

/**
 * As classes (e o `style`) de um colete. A cor livre entra por custom property
 * e a classe é literal (`colete-livre`, definida no globals.css): o Tailwind
 * gera utilitário varrendo o fonte, e `bg-[${cor}]` nunca existiria na folha
 * final — o mesmo arranjo de pinturaDoNome (nome-jogador.tsx). O vest.test.ts
 * lê este arquivo e cobra as duas coisas.
 */
function pinturaDoColete(cor: string | null | undefined): {
  style?: CSSProperties;
  className: string;
} {
  if (cor === undefined) return { className: "bg-surface-2 border-line-strong" };
  if (cor === null) return { className: "bg-transparent border-dashed border-fg-4" };
  return {
    style: { "--cor-do-colete": cor } as CSSProperties,
    className: "colete-livre",
  };
}
