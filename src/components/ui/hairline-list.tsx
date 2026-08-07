import Link from "next/link";
import { Children, type ComponentProps, type ReactNode } from "react";
import { cx } from "@/lib/cx";

/**
 * A lista de separadores de 1px que domina o design.
 *
 * `gap-px` sobre um fundo `line-soft`: os filhos, com fundo próprio, deixam a
 * linha aparecer entre eles. Sai de graça o que `border-bottom` cobra caro —
 * nada de `last:border-0`, e os cantos do primeiro e do último filho já vêm
 * recortados pelo `overflow-hidden`.
 */
export function HairlineList({
  as: Tag = "div",
  vazio,
  className,
  children,
}: {
  /** "ul"/"ol" quando a lista é mesmo uma lista: ranking, membros, presença. */
  as?: "div" | "ul" | "ol";
  /** Sem filhos, a caixa viraria uma hairline órfã de 1px. Devolve isto. */
  vazio?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  if (Children.count(children) === 0) return <>{vazio ?? null}</>;
  return (
    <Tag
      className={cx(
        "flex flex-col gap-px overflow-hidden rounded-card border border-line bg-line-soft",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

const linha = "flex flex-wrap items-center gap-x-2.5 gap-y-1 bg-surface px-3.5 py-2.5 text-[14px]";

export function HairlineRow({
  as: Tag = "div",
  destaque = false,
  apagado = false,
  className,
  children,
}: {
  as?: "div" | "li";
  /** A sua própria linha na lista de presença ou de ranking. */
  destaque?: boolean;
  /** Inativo, fora, descartado. */
  apagado?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Tag
      className={cx(
        linha,
        destaque && "bg-accent-tint",
        apagado && "text-fg-dim",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

/** Linha inteira clicável. Dentro de `as="ul"`, envolva num <li>. */
export function HairlineRowLink({ className, ...rest }: ComponentProps<typeof Link>) {
  return <Link {...rest} className={cx(linha, "transition-colors hover:bg-surface-2", className)} />;
}
