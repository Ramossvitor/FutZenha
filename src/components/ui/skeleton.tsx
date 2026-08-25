import { cx } from "@/lib/cx";

/**
 * Bloco pulsante que segura o lugar do conteúdo enquanto a página chega.
 *
 * Existe porque toda página é dinâmica (o layout lê a sessão a cada request):
 * em produção uma navegação leva mais de segundo, e a tela parada nesse meio
 * tempo é o que dava a sensação de site travado. Com reduced-motion o pulso
 * congela num cinza parado — continua comunicando "tem coisa vindo".
 */
export function Skeleton({
  as: Tag = "div",
  className,
}: {
  /**
   * "span" quando o esqueleto segura o lugar de um pedaço de TEXTO, e não de um
   * bloco: `<div>` dentro de `<p>` ou de `<strong>` é HTML inválido, e o parser
   * fecha o parágrafo antes da div. O DOM servido deixa de bater com a árvore
   * do React, e o que se ganha é mismatch de hidratação com o layout já rachado
   * — sem nenhum aviso do tsc, porque em JSX a aninhagem é legal.
   */
  as?: "div" | "span";
  className?: string;
}) {
  return <Tag aria-hidden className={cx("animate-pulse rounded-ctl bg-surface-2", className)} />;
}

/** O esqueleto genérico de página: cabeçalho + dois cards, no ritmo do design. */
export function PageSkeleton() {
  return (
    <div role="status" aria-label="Carregando" className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-8 w-56 max-w-full" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>

      <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-2/3" />
      </div>

      <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    </div>
  );
}
