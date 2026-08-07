import type { ReactNode } from "react";
import { cx } from "@/lib/cx";

export type BadgeTom = "neutral" | "accent" | "warn" | "danger" | "outline" | "dashed";

const tons: Record<BadgeTom, string> = {
  neutral: "border-transparent bg-surface-2 text-fg-3",
  accent: "border-accent-line bg-accent-tint text-accent-ink",
  warn: "border-warn-line bg-warn-tint text-warn-ink",
  danger: "border-danger-line bg-danger-tint text-danger-ink",
  outline: "border-line-strong bg-transparent text-fg-3",
  dashed: "border-dashed border-line-strong bg-transparent text-fg-4",
};

/**
 * O micro-selo do design.
 *
 * `caixa="alta"` é o padrão — Archivo condensado em caixa alta, que é como o
 * design marca status. `caixa="normal"` fica para conteúdo que não é rótulo e
 * ficaria ilegível em caixa alta: @usuario, e-mail, nome de grupo.
 */
export function Badge({
  tom = "neutral",
  caixa = "alta",
  ponto = false,
  className,
  children,
}: {
  tom?: BadgeTom;
  caixa?: "alta" | "normal";
  /** Bolinha na cor do texto, para status que o design marca com ponto. */
  ponto?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cx(
        "inline-flex shrink-0 items-center gap-1.5 rounded-selo border px-1.5 py-0.5 font-display leading-[1.5]",
        caixa === "alta"
          ? "text-[10px] font-bold font-stretch-87% tracking-[.09em] uppercase"
          : "text-[11.5px] font-semibold font-stretch-100%",
        tons[tom],
        className,
      )}
    >
      {ponto && <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />}
      {children}
    </span>
  );
}
