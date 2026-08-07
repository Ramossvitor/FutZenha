"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cx } from "@/lib/cx";

/**
 * Item de navegação que sabe se está na rota atual.
 *
 * É o único componente de cliente do shell, e existe por um motivo só: o
 * layout raiz é Server Component e não recebe o pathname. Injetar um header
 * pelo proxy.ts também não serve — o matcher dele nem cobre `/`, `/peladas` e
 * `/rankings`, que são justamente as abas.
 *
 * "/" casa exato; o resto casa por prefixo, para que /pelada/12 mantenha a aba
 * Peladas acesa.
 */
export function NavLink({
  href,
  label,
  icone,
  forma,
  exato = false,
  selo,
}: {
  href: string;
  label: string;
  icone: ReactNode;
  forma: "aba" | "lateral";
  exato?: boolean;
  selo?: ReactNode;
}) {
  const pathname = usePathname();
  const ativo = exato ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  if (forma === "aba") {
    return (
      <Link
        href={href}
        aria-current={ativo ? "page" : undefined}
        className={cx(
          // min-h-14 mantém o alvo de toque acima dos 44px mesmo com o rótulo miúdo
          "flex min-h-14 flex-1 flex-col items-center justify-center gap-1 rounded-ctl transition-colors",
          ativo ? "text-accent-ink" : "text-fg-dim hover:text-fg-2",
        )}
      >
        <span className="relative">
          <span className="block size-5">{icone}</span>
          {selo}
        </span>
        <span className="font-display text-[9.5px] font-extrabold tracking-[.1em] uppercase">
          {label}
        </span>
      </Link>
    );
  }

  return (
    <Link
      href={href}
      aria-current={ativo ? "page" : undefined}
      className={cx(
        "flex items-center gap-2.5 rounded-ctl px-3 py-2 font-display text-[13px] font-semibold transition-colors",
        ativo ? "bg-accent text-on-accent" : "text-fg-2 hover:bg-surface-2 hover:text-fg",
      )}
    >
      <span className="block size-[18px] shrink-0">{icone}</span>
      <span className="flex-1">{label}</span>
      {selo}
    </Link>
  );
}
