import Link from "next/link";
import { IconeGrupo } from "@/components/ui/icons";
import type { DestinoDaTroca, GrupoAtual } from "@/lib/grupo-atual";
import type { GrupoDoSeletor } from "@/lib/grupos";
import { OpcaoDeGrupo } from "./opcao-de-grupo";
import { PAINEL_DE_GRUPO_ID } from "./seletor-de-grupo";

/**
 * O painel do seletor: a lista dos meus grupos, que troca o contexto sem sair
 * da tela atual.
 *
 * Mora no layout, e não dentro do chip, por dois motivos. Um painel em vez de
 * dois corta pela metade os <form> de Server Action que vão no payload de TODA
 * navegação — cada um carrega referência de action e argumento cifrado. E ele
 * precisa ficar fora do <aside> e do <header>: os dois somem por `display:none`
 * no breakpoint, e popover em subárvore não renderizada não abre.
 *
 * É popover nativo, e não <details> como o resto do app: só o popover fecha com
 * Escape e com clique fora sem uma linha de JS, devolve o foco ao chip sozinho
 * e sobe para o top layer — que é o que resolve de uma vez o z-30 da TopBar e o
 * corte da coluna de 236px da lateral. Com <details> seria z-index e listener
 * de documento na mão.
 *
 * Sem role="menu" de propósito: menu ARIA obriga navegação por setas e roving
 * tabindex, e aqui o Tab do browser já percorre o painel na ordem certa porque
 * ele está no top layer logo depois do invocador. Prometer a semântica sem
 * implementá-la é pior do que não prometer. `group` é o papel mais fraco que
 * ainda aceita nome acessível — num <div> pelado, cujo papel é `generic`, o
 * aria-label seria simplesmente descartado.
 */
export function PainelDeGrupo({
  grupo,
  grupos,
  aoTrocarGrupo,
}: {
  grupo: GrupoAtual | null;
  grupos: GrupoDoSeletor[];
  /** A Server Action da troca, injetada pelo layout — ver o `aoSair` da Sidebar. */
  aoTrocarGrupo: (groupId: number | null, destino: DestinoDaTroca) => Promise<void>;
}) {
  // O <form> envolve TODA linha, ativa incluída, mesmo a ativa não tendo como
  // submeter. É o que mantém a mesma instância de OpcaoDeGrupo montada quando a
  // linha clicada vira a ativa — sem isso o efeito que fecha o painel some no
  // meio do caminho. Ver o comentário de lá.
  const linha = (ativo: boolean, groupId: number | null, rotulo: string) => (
    // "ficar" vai explícito e não pelo default do parâmetro: o React acrescenta
    // o FormData como próximo argumento do `.bind`, então sem ele quem cairia no
    // lugar do destino era o FormData.
    <form key={groupId ?? "todas"} action={aoTrocarGrupo.bind(null, groupId, "ficar")}>
      <OpcaoDeGrupo ativo={ativo}>{rotulo}</OpcaoDeGrupo>
    </form>
  );

  return (
    <div
      id={PAINEL_DE_GRUPO_ID}
      popover="auto"
      data-painel-grupo
      role="group"
      aria-label="Trocar de grupo"
      className="flex max-h-[min(65svh,26rem)] w-[min(19rem,calc(100vw-1.5rem))] flex-col overflow-y-auto overscroll-contain rounded-card border border-line bg-surface p-0 text-fg shadow-[0_16px_40px_-12px_rgb(0_0_0/.35)] backdrop:bg-black/25"
    >
      {linha(grupo === null, null, "Todas as peladas")}
      {grupos.map((g) => linha(grupo?.id === g.id, g.id, g.name))}

      {/* Convite, descoberta e criar grupo vivem no hub e nada disso cabe
          aqui — mas ele fica a um toque. */}
      <Link
        href="/grupos"
        className="flex items-center gap-2.5 border-t border-line px-3.5 py-2.5 text-[13px] text-accent-ink transition-colors hover:bg-surface-2"
      >
        <IconeGrupo className="size-4 shrink-0" />
        Todos os grupos e convites
      </Link>
    </div>
  );
}
