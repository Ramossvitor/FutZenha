import { cx } from "@/lib/cx";

export type TomDaBarra = "accent" | "warn" | "danger" | "neutral";

const preenchimentos: Record<TomDaBarra, string> = {
  accent: "bg-accent",
  warn: "bg-warn",
  danger: "bg-danger",
  neutral: "bg-fg-dim",
};

/**
 * Barra de progresso.
 *
 * A largura vai por `style` de propósito: `w-[${pct}%]` seria uma classe
 * montada em runtime, e o Tailwind — que gera CSS varrendo o código-fonte —
 * nunca a produziria. A barra sairia sempre zerada.
 */
export function Meter({
  valor,
  total,
  tom = "accent",
  rotulo,
  className,
}: {
  valor: number;
  total: number;
  tom?: TomDaBarra;
  /** Some do desenho e vai para o leitor de tela, que não enxerga a barra. */
  rotulo?: string;
  className?: string;
}) {
  const pct = total > 0 ? Math.min(100, Math.max(0, (valor / total) * 100)) : 0;
  return (
    <div
      role="progressbar"
      aria-valuenow={valor}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-label={rotulo}
      className={cx("h-1.5 w-full overflow-hidden rounded-full bg-line-soft", className)}
    >
      <div
        className={cx("h-full origin-left rounded-full animate-flood", preenchimentos[tom])}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/**
 * A barra da votação: a favor e contra na mesma trilha, e o resto é o silêncio
 * de quem não votou — que, pela regra, conta contra.
 */
export function BarraDaVotacao({
  sim,
  nao,
  elegiveis,
  className,
}: {
  sim: number;
  nao: number;
  elegiveis: number;
  className?: string;
}) {
  const p = (n: number) => (elegiveis > 0 ? Math.max(0, (n / elegiveis) * 100) : 0);
  return (
    <div
      className={cx("flex h-1.5 w-full overflow-hidden rounded-full bg-line-soft", className)}
      role="img"
      aria-label={`${sim} a favor, ${nao} contra, de ${elegiveis} eleitores`}
    >
      <div className="h-full bg-accent" style={{ width: `${p(sim)}%` }} />
      <div className="h-full bg-danger" style={{ width: `${p(nao)}%` }} />
    </div>
  );
}
