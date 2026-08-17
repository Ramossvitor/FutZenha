"use client";

import type { MouseEvent } from "react";
import { IconeAtualizar, IconeCarregando, IconeCheck } from "@/components/ui/icons";
import { cx } from "@/lib/cx";
import { ROTULO, useAtualizacao } from "./use-atualizacao";

/**
 * O disparo do desktop: ícone no cabeçalho da lateral, ao lado do wordmark.
 *
 * No celular não existe — lá o caminho é o gesto de puxar (puxar-para-atualizar.tsx),
 * e um quarto ícone na TopBar comeria a largura do chip do grupo.
 */
export function BotaoAtualizar() {
  const { atualizar, estado } = useAtualizacao();
  const ocupado = estado !== "parado";

  function aoClicar(evento: MouseEvent<HTMLAnchorElement>) {
    // Deixa passar o que o browser faz melhor: abrir noutra aba, noutra janela.
    if (evento.metaKey || evento.ctrlKey || evento.shiftKey || evento.button !== 0) return;
    evento.preventDefault();
    atualizar();
  }

  return (
    // <a href=""> e não <button>: string vazia resolve para a URL do documento
    // atual, query inclusa, então SEM JS um clique recarrega a página de verdade
    // — que é o refresh honesto, só mais caro. Com JS, preventDefault e
    // router.refresh(), que traz só o payload RSC, sem HTML, JS nem fontes.
    //
    // Nem `Button` nem `LinkButton` do kit servem: o primeiro renderiza <button>
    // (perde o caminho sem JS) e o segundo é next/link, cuja navegação suave
    // para a rota atual pode sair do Router Cache — exatamente o oposto do que
    // este controle promete.
    <a
      href=""
      onClick={aoClicar}
      aria-disabled={ocupado || undefined}
      aria-busy={estado === "atualizando" || undefined}
      // Região viva SEMPRE, e não só quando ocupado: um aria-live que nasce
      // junto com a mudança não é anunciado — o mesmo raciocínio já escrito em
      // ui/button.tsx. Aqui o nome acessível é o próprio texto do sr-only, que
      // muda com o estado; por isso não há aria-label fixo por cima.
      aria-live="polite"
      className={cx(
        "flex size-9 shrink-0 items-center justify-center rounded-ctl border border-line",
        "bg-surface text-fg-2 transition-colors hover:border-line-hover hover:text-fg",
        "aria-disabled:pointer-events-none aria-disabled:opacity-45",
      )}
    >
      {/* 36px e não os 40px do sino da TopBar: aqui é ponteiro fino, então o
          piso de 44px de alvo de toque não se aplica, e o quadrado maior
          engolia o wordmark ao lado.

          Com as animações desligadas o `animate-spin` congela, e aqui o rótulo
          é sr-only — quem enxerga não teria texto para ler. Quem carrega o
          estado então são duas coisas estáticas: a TROCA de ícone (seta → arco
          → check) e o opacity-45 que vem junto do aria-disabled. É a regra do
          globals.css: o estado parado do que anima já tem de ser legível. */}
      {estado === "atualizando" ? (
        <IconeCarregando className="size-[18px] animate-spin" />
      ) : estado === "concluido" ? (
        <IconeCheck className="size-[18px]" />
      ) : (
        <IconeAtualizar className="size-[18px]" />
      )}
      <span className="sr-only">{ROTULO[estado]}</span>
    </a>
  );
}
