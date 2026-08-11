import Link from "next/link";
import type { ComponentProps, CSSProperties, ReactNode } from "react";
import { cx } from "@/lib/cx";

export function Card({
  className,
  style,
  children,
}: {
  className?: string;
  /**
   * Só para o que o Tailwind não consegue gerar: valor calculado em runtime,
   * hoje o `animationDelay` da cascata dos times. O Tailwind varre o código
   * para gerar CSS, então `delay-[${i * 70}ms]` nunca existiria na folha — o
   * mesmo motivo que põe a largura da Meter num style. Cor, padding e raio
   * continuam fora, aqui como no className.
   */
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <div className={cx("rounded-card border border-line bg-surface", className)} style={style}>
      {children}
    </div>
  );
}

/** Card que navega. Card clicável tem que ser âncora, não div com onClick. */
export function CardLink({ className, ...rest }: ComponentProps<typeof Link>) {
  return (
    <Link
      {...rest}
      className={cx(
        "block rounded-card border border-line bg-surface transition-colors hover:border-line-hover hover:bg-surface-2",
        className,
      )}
    />
  );
}

export function CardHeader({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cx(
        "flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line bg-surface-2 px-4 py-3",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("p-4", className)}>{children}</div>;
}

/** Rótulo de seção: Archivo miúdo, caixa alta, muito espaçado. */
export function Eyebrow({ className, children }: { className?: string; children: ReactNode }) {
  return <span className={cx("eyebrow", className)}>{children}</span>;
}

/**
 * Bloco de conteúdo com eyebrow e, opcionalmente, um link de ação à direita.
 * É o ritmo que o design repete em toda tela.
 */
export function Section({
  titulo,
  acao,
  className,
  children,
}: {
  titulo?: ReactNode;
  acao?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cx("flex flex-col gap-2.5", className)}>
      {(titulo || acao) && (
        <div className="flex items-baseline justify-between gap-3">
          {titulo ? <Eyebrow>{titulo}</Eyebrow> : <span />}
          {acao}
        </div>
      )}
      {children}
    </section>
  );
}

/** O link "VER TODAS ›" que acompanha o eyebrow. */
export function SectionLink({ className, children, ...rest }: ComponentProps<typeof Link>) {
  return (
    <Link
      {...rest}
      className={cx(
        "font-display text-[10px] font-bold tracking-[.1em] text-accent-ink uppercase hover:underline",
        className,
      )}
    >
      {children} ›
    </Link>
  );
}

/** Cabeçalho de página: selos, título grande em Archivo expandido e subtítulo. */
export function PageHeader({
  titulo,
  selos,
  descricao,
  acao,
  className,
}: {
  titulo: ReactNode;
  selos?: ReactNode;
  descricao?: ReactNode;
  acao?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cx("flex flex-col gap-3", className)}>
      {selos && <div className="flex flex-wrap items-center gap-2">{selos}</div>}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-display text-[26px] leading-[1.05] font-black font-stretch-125% tracking-[-.015em] text-fg uppercase sm:text-[30px]">
          {titulo}
        </h1>
        {acao}
      </div>
      {descricao && <div className="text-[14px] leading-[1.5] text-fg-2">{descricao}</div>}
    </header>
  );
}
