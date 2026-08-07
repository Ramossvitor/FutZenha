import Link from "next/link";
import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from "react";
import { cx } from "@/lib/cx";

// Nada de `server-only` aqui: este módulo é importado pelo pending-button, que
// é client, então ele entra no grafo do cliente como módulo compartilhado.

export type BotaoVariante =
  | "primary" // lime cheio — a ação principal da tela
  | "secondary" // contorno
  | "ghost" // sem caixa, para ação terciária em linha
  | "danger" // vermelho cheio — ponto de não retorno
  | "danger-outline" // contorno vermelho — remover, revogar, denunciar
  | "inverse"; // inverte fundo e texto

export type BotaoTamanho = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 rounded-ctl " +
  "font-display font-semibold font-stretch-112% whitespace-nowrap select-none " +
  "border transition-[background-color,border-color,color,translate] duration-150 " +
  "active:translate-y-px " +
  "disabled:pointer-events-none disabled:opacity-45 " +
  "aria-disabled:pointer-events-none aria-disabled:opacity-45";

// h-10 e h-12 passam dos 44px de alvo de toque com folga; o `sm` (32px) fica
// para ação secundária em linha, onde há espaçamento em volta.
const tamanhos: Record<BotaoTamanho, string> = {
  sm: "h-8 px-3 text-[12px]",
  md: "h-10 px-4 text-[13px]",
  lg: "h-12 px-5 text-[15px]",
};

const variantes: Record<BotaoVariante, string> = {
  // A borda `accent-edge` não é enfeite: no tema claro o lime cheio dá 1,36:1
  // contra o branco e o botão flutuaria sem contorno nenhum. No escuro o token
  // é o próprio lime, então a mesma string serve aos dois temas.
  primary: "border-accent-edge bg-accent text-on-accent hover:bg-accent-hover",
  secondary: "border-line-strong bg-transparent text-fg hover:border-line-hover hover:bg-surface-2",
  ghost: "border-transparent bg-transparent text-fg-2 hover:bg-surface-2 hover:text-fg",
  danger: "border-transparent bg-danger text-on-danger hover:bg-danger-hover",
  "danger-outline": "border-danger-line bg-transparent text-danger-ink hover:bg-danger-tint",
  inverse: "border-transparent bg-inverse text-on-inverse hover:opacity-90",
};

export type BotaoProps = {
  variante?: BotaoVariante;
  tamanho?: BotaoTamanho;
  /**
   * Não é hook — é prop. Vem do `useActionState` de quem chama (que já é
   * client) ou do <PendingButton>. É o que mantém este arquivo sem "use client".
   */
  pending?: boolean;
  labelPending?: ReactNode;
  /** Só layout: ml-auto, w-full, flex-1. Nunca cor, padding ou raio. */
  className?: string;
};

export function Button({
  variante = "primary",
  tamanho = "md",
  pending = false,
  labelPending,
  className,
  children,
  type = "button",
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & BotaoProps) {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={cx(base, tamanhos[tamanho], variantes[variante], className)}
    >
      {pending ? (labelPending ?? children) : children}
    </button>
  );
}

/** O caso dominante: <form action={serverAction}> com um submit dentro. */
export function SubmitButton(props: ButtonHTMLAttributes<HTMLButtonElement> & BotaoProps) {
  return <Button {...props} type="submit" />;
}

/** Mesmas classes, mas navega. */
export function LinkButton({
  variante = "primary",
  tamanho = "md",
  className,
  ...rest
}: ComponentProps<typeof Link> & Omit<BotaoProps, "pending" | "labelPending">) {
  return (
    <Link {...rest} className={cx(base, tamanhos[tamanho], variantes[variante], className)} />
  );
}
