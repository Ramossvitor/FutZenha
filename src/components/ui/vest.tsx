import { cx } from "@/lib/cx";
import { colete } from "@/lib/team-colors";

export type TamanhoColete = "sm" | "md" | "lg";

// Proporção de camisa: um pouco mais alto que largo.
const tamanhos: Record<TamanhoColete, string> = {
  sm: "h-[11px] w-[9px]",
  md: "h-[16px] w-[13px]",
  lg: "h-[19px] w-[16px]",
};

/**
 * O retângulo de cor do colete.
 *
 * `aria-hidden` sempre: o nome do time vem escrito ao lado, e cor não pode ser
 * o único portador de informação — nem para quem não enxerga, nem para os 8%
 * de daltônicos que não distinguem o time Verde do Vermelho.
 */
export function VestChip({
  time,
  tamanho = "md",
  className,
}: {
  time: string;
  tamanho?: TamanhoColete;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cx("inline-block shrink-0 rounded-selo border", tamanhos[tamanho], colete(time), className)}
    />
  );
}

/** Chip + nome do time, que é o par que o design usa em toda parte. */
export function Vest({
  time,
  tamanho = "md",
  className,
}: {
  time: string;
  tamanho?: TamanhoColete;
  className?: string;
}) {
  return (
    <span className={cx("inline-flex items-center gap-2", className)}>
      <VestChip time={time} tamanho={tamanho} />
      <span className="font-display text-[13px] font-bold font-stretch-112% text-fg">{time}</span>
    </span>
  );
}
