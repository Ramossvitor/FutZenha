import type { ReactNode } from "react";
import { Wordmark } from "@/components/shell/marca";
import { cx } from "@/lib/cx";

/**
 * O cartão centrado das telas de porta de entrada: login, convite de conta e
 * convite de grupo.
 *
 * A string dele estava copiada em três arquivos, e já tinha divergido. Aqui
 * também mora a decisão de mostrar a marca: são as únicas telas do app sem
 * barra lateral nem abas, então sem o logotipo a pessoa não sabe onde caiu —
 * e um link de convite chega quase sempre de alguém que só disse "entra aí".
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
      <Wordmark tamanho="lg" className="self-center" />

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
