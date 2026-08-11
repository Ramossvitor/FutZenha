"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cx } from "@/lib/cx";

/**
 * O miolo do link apaga enquanto a navegação está em voo.
 *
 * Toda página aqui é dinâmica (o layout lê a sessão), então cada toque numa aba
 * espera o servidor — em produção isso passa de segundo, e sem nenhuma reação
 * visual a pessoa toca de novo achando que não pegou. O `delay-150` segura o
 * apagar nas navegações rápidas, que não precisam dele.
 *
 * Sem `animate-pulse` de propósito: os keyframes do pulso mandam na opacidade
 * (declaração de animação ganha de declaração normal na cascata), então eles
 * atropelariam o `opacity-60` E o delay — que é `transition-delay` e não atrasa
 * animação nenhuma. O resultado seria piscar na hora em toda navegação, o
 * oposto do que este componente quer.
 */
function MioloDoLink({ className, children }: { className: string; children: ReactNode }) {
  const { pending } = useLinkStatus();
  return (
    <span
      className={cx(
        className,
        "transition-opacity",
        pending ? "opacity-60 delay-150" : "opacity-100",
      )}
    >
      {children}
    </span>
  );
}

/**
 * Item de navegação que sabe se está na rota atual.
 *
 * É o único componente de cliente do shell, e existe por um motivo só: o
 * layout raiz é Server Component e não recebe o pathname. Injetar um header
 * pelo proxy.ts também não serve — o matcher dele nem cobre `/`, `/futs` e
 * `/rankings`, que são justamente as abas.
 *
 * "/" casa exato; o resto casa por prefixo, para que /fut/12 mantenha a aba
 * Futs acesa.
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
          "flex min-h-14 flex-1 rounded-ctl transition-colors",
          ativo ? "text-accent-ink" : "text-fg-dim hover:text-fg-2",
        )}
      >
        <MioloDoLink className="flex flex-1 flex-col items-center justify-center gap-1">
          <span className="relative">
            <span className="block size-5">{icone}</span>
            {selo}
          </span>
          <span className="font-display text-[9.5px] font-extrabold tracking-[.1em] uppercase">
            {label}
          </span>
        </MioloDoLink>
      </Link>
    );
  }

  return (
    <Link
      href={href}
      aria-current={ativo ? "page" : undefined}
      className={cx(
        "flex rounded-ctl transition-colors",
        ativo ? "bg-accent text-on-accent" : "text-fg-2 hover:bg-surface-2 hover:text-fg",
      )}
    >
      <MioloDoLink className="flex flex-1 items-center gap-2.5 px-3 py-2 font-display text-[13px] font-semibold">
        <span className="block size-[18px] shrink-0">{icone}</span>
        <span className="flex-1">{label}</span>
        {selo}
      </MioloDoLink>
    </Link>
  );
}
