import { cx } from "@/lib/cx";

/**
 * O título comprado, ao lado do nome no perfil.
 *
 * O nome do produto vai ESCRITO porque nele o nome é o produto: "Camisa 10" não
 * tem desenho, tem piada. É o que sobrou do antigo `Selo`, que fazia esse papel
 * para os cinco tipos de item da loja de texto — badge agora é imagem, e
 * moldura e cor do nome são a cor de outra coisa.
 *
 * ── Por que não é um `Badge` ────────────────────────────────────────────────
 *
 * O `Badge` diz o que o APP afirma sobre a pessoa: goleiro, você, fora das
 * listas. Este diz o que ela COMPROU. São duas autoridades diferentes na mesma
 * tela, e misturá-las faria a loja parecer que concede status.
 *
 * A diferença é de SILHUETA, e não de cor, porque cor não sobrevive a daltonismo
 * nem a uma captura de tela em preto e branco: o Badge é retangular, de canto
 * duro, condensado e caixa alta — um carimbo. Este é cápsula redonda, aberta por
 * um losango. Dá para distinguir os dois de longe e sem enxergar cor nenhuma.
 */
export function ChipDeTitulo({ nome, className }: { nome: string; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full border border-line-strong px-2.5 py-[3px]",
        "font-display text-[11.5px] leading-none font-bold font-stretch-112% text-fg-2",
        className,
      )}
    >
      <span aria-hidden className="size-[5px] rotate-45 bg-fg-3" />
      {nome}
    </span>
  );
}
