import Link from "next/link";
import type { ComponentProps } from "react";
import { cx } from "@/lib/cx";

/**
 * A pílula de filtro: aba e ano nos rankings, grupo no perfil público.
 *
 * Mora aqui, e não no componente de ranking que a estreou, pela mesma razão do
 * ./nome-jogador: assim que a segunda tela precisou dela, exportá-la de
 * components/rankings faria o perfil importar a árvore de consultas de stats
 * para pintar um link.
 */
export function Pilula({
  ativo,
  children,
  ...rest
}: { ativo: boolean } & ComponentProps<typeof Link>) {
  return (
    <Link
      {...rest}
      aria-current={ativo ? "page" : undefined}
      className={cx(
        "shrink-0 rounded-ctl border px-3 py-1.5 font-display text-[12px] font-bold font-stretch-112% whitespace-nowrap transition-colors",
        ativo
          ? "border-accent-edge bg-accent text-on-accent"
          : "border-line-strong bg-surface text-fg-2 hover:border-line-hover hover:text-fg",
      )}
    >
      {children}
    </Link>
  );
}
