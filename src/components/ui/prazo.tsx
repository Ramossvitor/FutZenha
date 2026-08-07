import { cx } from "@/lib/cx";
import { textoDePrazo, tomDePrazo, type TomDePrazo } from "@/lib/prazo";

// O "relógio único": todo prazo do produto — avaliação, votação, janela de
// correção, convite — usa este mesmo selo. Cinza acima de 24h, âmbar abaixo,
// vermelho pulsando abaixo de 6h.

const cores: Record<TomDePrazo, string> = {
  calmo: "border-line bg-surface-2 text-fg-3",
  apertado: "border-warn-line bg-warn-tint text-warn-ink",
  urgente: "border-danger-line bg-danger-tint text-danger-ink",
  vencido: "border-line bg-surface-2 text-fg-dim",
};

const pontos: Record<TomDePrazo, string> = {
  calmo: "bg-fg-dim",
  apertado: "bg-warn",
  urgente: "bg-danger animate-urg",
  vencido: "bg-fg-faint",
};

/**
 * @param horas Sempre o `horasRestantes` que o Postgres já calculou. É regra do
 *   projeto não olhar o relógio no render — daria número diferente a cada
 *   re-render e quebraria a pureza do Server Component.
 * @param sobre "accent" quando o selo fica em cima de uma faixa lime, onde o
 *   tint claro sumiria.
 */
export function Prazo({
  horas,
  prefixo,
  sobre = "surface",
  className,
}: {
  horas: number;
  prefixo?: string;
  sobre?: "surface" | "accent";
  className?: string;
}) {
  const tom = tomDePrazo(horas);
  const texto = textoDePrazo(horas);
  return (
    <span
      className={cx(
        "inline-flex shrink-0 items-center gap-1.5 rounded-selo border px-1.5 py-1 font-display text-[10px] font-extrabold tracking-[.08em] uppercase",
        sobre === "accent" ? "border-transparent bg-pit/60 text-fg" : cores[tom],
        className,
      )}
    >
      <span aria-hidden className={cx("size-1.5 shrink-0 rounded-full", pontos[tom])} />
      {prefixo ? `${prefixo} · ${texto}` : texto}
    </span>
  );
}
