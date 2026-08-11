import Link from "next/link";
import { IconeSeta, Marca } from "@/components/ui/icons";
import type { GrupoAtual } from "@/lib/grupo-atual";
import { cx } from "@/lib/cx";
import { PAINEL_DE_GRUPO_ID } from "./seletor-de-grupo";

/**
 * O chip de grupo do cabeçalho: diz em que contexto a pessoa está navegando e
 * abre o seletor. O painel em si é o PainelDeGrupo, que o layout monta uma vez
 * só para os dois chips — aqui fica só o invocador.
 */
export function ChipDoGrupo({
  forma,
  grupo,
  temSeletor,
  className,
}: {
  /**
   * Onde este chip vive. Não é enfeite: lateral e topo ficam AS DUAS no DOM (o
   * breakpoint só esconde uma), e é este atributo que vira o `anchor-name` de
   * cada uma no CSS — o painel se ancora na que estiver na tela.
   */
  forma: "topo" | "lateral";
  grupo: GrupoAtual | null;
  /**
   * Se existe painel para abrir. Sem grupo nenhum não há o que escolher — abrir
   * um painel de uma opção só seria a mesma promessa vazia que a seta fazia
   * antes, então o chip vira o atalho para o hub, agora sem seta. O corte é em
   * zero e não em um: com um grupo, alternar para "todos os futs" ainda é
   * uma escolha de verdade.
   */
  temSeletor: boolean;
  className?: string;
}) {
  const rotulo = grupo ? grupo.name : "Todos os futs";

  const caixa = cx(
    "flex min-w-0 items-center gap-2.5 rounded-ctl border border-line bg-surface px-2.5 py-1.5 text-left transition-colors hover:border-line-hover hover:bg-surface-2",
    className,
  );

  const miolo = (
    <>
      <Marca className="h-[19px] w-auto shrink-0 text-accent" />
      <span className="min-w-0 flex-1">
        <span className="block font-display text-[9px] leading-none font-bold tracking-[.16em] text-fg-4 uppercase">
          Grupo
        </span>
        <span className="block truncate font-display text-[14px] leading-[1.25] font-extrabold font-stretch-112% text-fg">
          {rotulo}
        </span>
      </span>
    </>
  );

  if (!temSeletor) {
    return (
      <Link href="/grupos" className={caixa}>
        {miolo}
      </Link>
    );
  }

  return (
    <button
      type="button"
      popoverTarget={PAINEL_DE_GRUPO_ID}
      data-chip-grupo={forma}
      aria-label={`Grupo: ${rotulo}. Trocar de grupo`}
      className={caixa}
    >
      {miolo}
      <IconeSeta className="size-3.5 shrink-0 rotate-90 text-fg-4" />
    </button>
  );
}
