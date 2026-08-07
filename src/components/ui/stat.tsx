import type { ReactNode } from "react";
import { cx } from "@/lib/cx";

/**
 * A grade de indicadores. Usa a mesma hairline das listas: gap de 1px sobre o
 * fundo da linha, então as células ficam separadas por fios sem nenhuma borda.
 */
export function StatGrid({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cx(
        "grid gap-px overflow-hidden rounded-card border border-line bg-line-soft",
        // Duas colunas no celular e três a partir do sm: a 390px, um terço da
        // largura não comporta rótulo como "APROVEITAMENTO" ou "ORGANIZADORES",
        // e eles quebravam no meio da palavra.
        "grid-cols-2 sm:grid-cols-3",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function StatTile({
  label,
  valor,
  nota,
  className,
}: {
  label: ReactNode;
  valor: ReactNode;
  /** Linha miúda embaixo, para a ressalva que o número sozinho não conta. */
  nota?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("flex flex-col gap-0.5 bg-surface px-3 py-3", className)}>
      {/* Sem a utilitária `eyebrow` de propósito: ela e o `text-[9px]` caem na
          mesma camada e a ordem entre as duas não é garantida, então o override
          era sorte. Aqui as classes são explícitas.

          9px e tracking menor porque numa célula de 1/3 a 390px
          "APROVEITAMENTO" não cabe no tamanho padrão — e, sendo uma palavra só,
          ela não tem onde quebrar: o overflow-hidden da grade cortava o texto
          no meio, sem nem reticência. O overflow-wrap é o seguro contra o
          próximo rótulo comprido. */}
      <span className="font-display text-[9px] leading-none font-extrabold tracking-[.1em] text-fg-4 uppercase [overflow-wrap:anywhere]">
        {label}
      </span>
      <span
        className="font-display text-[20px] leading-[1.1] font-black font-stretch-112% text-fg"
        data-num
      >
        {valor}
      </span>
      {nota && <span className="text-[11px] leading-[1.3] text-fg-4">{nota}</span>}
    </div>
  );
}
