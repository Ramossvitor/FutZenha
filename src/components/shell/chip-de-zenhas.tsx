import Link from "next/link";
import { IconeZenha } from "@/components/ui/icons";
import { cx } from "@/lib/cx";

/**
 * O saldo no cabeçalho, e o atalho para o extrato.
 *
 * Recebe o número por prop em vez de buscá-lo: quem lê a carteira é o layout,
 * junto com as outras buscas da sessão num `Promise.all` só. Um componente de
 * servidor que fosse ao banco por conta própria acrescentaria um round-trip
 * SERIAL a toda navegação do app — o mesmo motivo que já está escrito lá.
 *
 * Vive nos dois shells (a TopBar é `lg:hidden`, a Sidebar é `lg:flex`), então
 * `forma` só ajusta a caixa. Um chip só deixaria metade dos aparelhos sem saber
 * quanto tem — e o celular é justamente o alvo do produto.
 *
 * O número vai escrito com a palavra no aria-label porque "1.240" sozinho, ao
 * lado do nome do grupo, não diz de quê.
 */
export function ChipDeZenhas({
  saldo,
  forma,
  className,
}: {
  saldo: number;
  forma: "topo" | "lateral";
  className?: string;
}) {
  return (
    <Link
      href="/zenhas"
      aria-label={`${saldo} ${saldo === 1 ? "zenha" : "zenhas"}. Ver o extrato`}
      className={cx(
        "flex shrink-0 items-center gap-1.5 rounded-ctl border border-line bg-surface text-fg transition-colors hover:border-line-hover hover:bg-surface-2",
        // No topo ele divide a faixa com o chip do grupo, o sino e o avatar:
        // altura de alvo de toque (40px) e nada de rótulo. Na lateral sobra
        // largura, então ele ocupa a linha inteira embaixo do chip do grupo.
        forma === "topo" ? "h-10 px-2.5" : "w-full px-2.5 py-1.5",
        className,
      )}
    >
      <IconeZenha className="size-[18px] shrink-0 text-accent-ink" />
      <span
        className="font-display text-[14px] leading-none font-extrabold font-stretch-112%"
        data-num
      >
        {saldo.toLocaleString("pt-BR")}
      </span>
      {forma === "lateral" && (
        <span className="font-display text-[9px] leading-none font-bold tracking-[.16em] text-fg-4 uppercase">
          {saldo === 1 ? "zenha" : "zenhas"}
        </span>
      )}
    </Link>
  );
}
