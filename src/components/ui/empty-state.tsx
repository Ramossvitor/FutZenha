import type { ReactNode } from "react";
import { cx } from "@/lib/cx";

/**
 * A caixa tracejada do design.
 *
 * Estado vazio é tela de verdade, não ausência de tela: diz o que aconteceu e,
 * quando existe, o que fazer a respeito.
 */
export function EmptyState({
  titulo,
  descricao,
  acao,
  className,
}: {
  titulo: ReactNode;
  descricao?: ReactNode;
  acao?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "flex flex-col items-center gap-2 rounded-card border border-dashed border-dash px-5 py-7 text-center",
        className,
      )}
    >
      <p className="font-display text-[16px] font-bold font-stretch-112% text-fg-2">{titulo}</p>
      {descricao && (
        <p className="max-w-prose text-[13px] leading-[1.5] text-fg-4">{descricao}</p>
      )}
      {acao && <div className="mt-1.5">{acao}</div>}
    </div>
  );
}
