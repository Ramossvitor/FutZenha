import type { ReactNode } from "react";
import { cx } from "@/lib/cx";

/**
 * O cartão centrado das telas de porta de entrada: login, convite de conta e
 * convite de grupo.
 *
 * A string dele estava copiada em três arquivos, e já tinha divergido.
 *
 * Sem logotipo aqui de propósito: estas telas NÃO estão fora do shell — o
 * layout raiz é um só e vale para elas também. Deslogado, a TopBar já mostra o
 * Wordmark no celular e a Sidebar no desktop, então um segundo dentro do cartão
 * empilhava a marca duas vezes na mesma tela.
 */
export function CartaoDeEntrada({
  titulo,
  descricao,
  children,
  rodape,
}: {
  titulo: ReactNode;
  descricao?: ReactNode;
  children?: ReactNode;
  rodape?: ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-5 py-6 sm:py-12">
      <div className="rounded-card border border-line bg-surface p-5">
        <h1 className="font-display text-[21px] leading-[1.15] font-extrabold font-stretch-112% text-fg">
          {titulo}
        </h1>
        {descricao && (
          <div className="mt-2 text-[13.5px] leading-[1.5] text-fg-2">{descricao}</div>
        )}
        {children && <div className="mt-4">{children}</div>}
      </div>

      {rodape && <div className="text-center text-[12.5px] text-fg-4">{rodape}</div>}
    </div>
  );
}

/** O divisor "ou" entre os dois caminhos de login. */
export function Divisor({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx("flex items-center gap-3", className)}>
      <span className="h-px flex-1 bg-line" />
      <span className="font-display text-[10px] font-bold tracking-[.14em] text-fg-4 uppercase">
        {children}
      </span>
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}
