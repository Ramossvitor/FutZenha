"use client";

import type { ButtonHTMLAttributes } from "react";
import { useFormStatus } from "react-dom";
import { cx } from "@/lib/cx";

/**
 * Submit sem a caixa do Button — para quando o cartão INTEIRO é o alvo do
 * toque (trocar de contexto em /grupos). Escurece, pulsa e trava reenvio
 * enquanto a action está em voo, pelo mesmo motivo do SubmitButton: uma
 * Server Action em produção leva mais de segundo, e silêncio parece
 * travamento.
 */
export function SubmitDeCartao({
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  const { pending } = useFormStatus();
  return (
    <button
      {...rest}
      type="submit"
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={cx(className, pending && "animate-pulse opacity-60")}
    >
      {children}
    </button>
  );
}
