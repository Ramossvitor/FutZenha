"use client";

import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { cx } from "@/lib/cx";
import { useComemoracaoAoTerminar } from "./comemoracao";
import type { TomDaComemoracao } from "./comemoracao-ponto";
import { IconeCarregando } from "./icons";

// "use client" no arquivo inteiro é decisão de produto, não acidente: em
// produção uma Server Action leva de 1 a 4 segundos (cold start + banco), e um
// submit sem pending parece botão quebrado — a pessoa clica de novo e duplica a
// operação. O SubmitButton lê useFormStatus sozinho, então TODO submit do app
// desabilita e mostra spinner sem o caller fazer nada.

export type BotaoVariante =
  | "primary" // lime cheio — a ação principal da tela
  | "secondary" // contorno
  | "ghost" // sem caixa, para ação terciária em linha
  | "danger" // vermelho cheio — ponto de não retorno
  | "danger-outline"; // contorno vermelho — remover, revogar, denunciar

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
};

export type BotaoProps = {
  variante?: BotaoVariante;
  tamanho?: BotaoTamanho;
  /**
   * Força o estado ocupado por fora — útil com `useActionState`, quando o
   * pending certo é o da action e não o do <form>. O SubmitButton soma este
   * valor ao do useFormStatus; no Button cru ele é a única fonte.
   */
  pending?: boolean;
  labelPending?: ReactNode;
  /** Só layout: ml-auto, w-full, flex-1. Nunca cor, padding ou raio. */
  className?: string;
};

/**
 * A festa é só do SubmitButton, e fica fora do BotaoProps de propósito: no
 * `Button` cru não há <form> de que esperar o fim, e um `festeja` que o tipo
 * aceitasse ali cairia no `...rest` e vazaria como atributo desconhecido no
 * <button>.
 */
export type FestaProps = {
  /**
   * Comemora quando a action deste form der certo — só nos submits em que o
   * produto tem mesmo o que comemorar. O valor é O FUNDO SOBRE O QUAL A BOLA
   * VAI CAIR, que o call site é o único a saber: quem sobrevive à action pousa
   * no próprio botão, quem some pousa na surface da página. Ver `tintas` em
   * comemoracao.tsx.
   *
   * A bola é desenhada pela CamadaDeComemoracao, no layout, e não aqui dentro:
   * em /fut/[id] confirmar presença REMOVE este botão da árvore, e um efeito
   * hospedado nele morreria antes de rodar.
   */
  festeja?: TomDaComemoracao;
  /**
   * O estado que a action deveria mudar — obrigatório onde o botão SOBREVIVE ao
   * submit, porque ali é o único jeito de separar "deu certo" de "voltou em
   * silêncio". Onde o botão desmonta no sucesso, a desmontagem já é a prova e
   * este valor não é preciso.
   */
  festejaQuando?: string;
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
}: ComponentProps<"button"> & BotaoProps) {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      // Região viva SEMPRE, e não só quando pending: um aria-live que nasce
      // junto com a mudança não é anunciado. Sem isto, a troca por
      // `labelPending` passava em silêncio — o `disabled` do mesmo render tira
      // o foco daqui e joga no <body>, então quem usa leitor de tela perdia ao
      // mesmo tempo a posição e o aviso de que a ação está em voo. O spinner
      // não entra no anúncio: os ícones já nascem `aria-hidden`.
      aria-live="polite"
      className={cx(base, tamanhos[tamanho], variantes[variante], className)}
    >
      {pending && <IconeCarregando className="size-[1.1em] shrink-0 animate-spin" />}
      {pending ? (labelPending ?? children) : children}
    </button>
  );
}

/**
 * O caso dominante: <form action={serverAction}> com um submit dentro.
 *
 * `useFormStatus` lê o <form> ancestral, então o pending vem de graça em
 * qualquer form — Server Component em volta continua server. A prop `pending`
 * soma (OR) para quem controla por `useActionState`.
 */
export function SubmitButton({
  pending,
  festeja,
  festejaQuando,
  variante = "primary",
  ...props
}: ComponentProps<"button"> & BotaoProps & FestaProps) {
  const status = useFormStatus();
  const emVoo = pending || status.pending;
  const ref = useComemoracaoAoTerminar(festeja, emVoo, festejaQuando);
  return <Button {...props} ref={ref} variante={variante} type="submit" pending={emVoo} />;
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
