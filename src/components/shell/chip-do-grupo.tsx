import Link from "next/link";
import { cx } from "@/lib/cx";
import { Marca } from "@/components/ui/icons";
import type { GrupoAtual } from "@/lib/grupo-atual";

/**
 * O seletor de grupo do cabeçalho.
 *
 * É um <Link> para o hub, não um menu suspenso: trocar de grupo é uma escolha
 * que envolve ver pendências e nota de cada um, e isso não cabe num dropdown.
 * De quebra, o shell inteiro continua sem JavaScript.
 */
export function ChipDoGrupo({
  grupo,
  className,
}: {
  grupo: GrupoAtual | null;
  className?: string;
}) {
  return (
    <Link
      href="/grupos"
      className={cx(
        "flex min-w-0 items-center gap-2.5 rounded-ctl border border-line bg-surface px-2.5 py-1.5 transition-colors hover:border-line-hover hover:bg-surface-2",
        className,
      )}
    >
      <Marca className="h-[19px] w-auto shrink-0 text-accent" />
      <span className="min-w-0 flex-1">
        <span className="block font-display text-[9px] leading-none font-bold tracking-[.16em] text-fg-4 uppercase">
          Grupo
        </span>
        <span className="block truncate font-display text-[14px] leading-[1.25] font-extrabold font-stretch-112% text-fg">
          {grupo ? grupo.name : "Todas as peladas"}
        </span>
      </span>
      <span aria-hidden className="shrink-0 text-[10px] text-fg-4">
        ▾
      </span>
    </Link>
  );
}
