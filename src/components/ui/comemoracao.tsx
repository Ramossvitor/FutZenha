"use client";

import { useEffect, useRef, useState } from "react";
import { cx } from "@/lib/cx";
import {
  EVENTO_COMEMORACAO,
  pontoDaComemoracao,
  type CaixaDoAlvo,
  type Comemoracao,
  type TomDaComemoracao,
} from "./comemoracao-ponto";
import { IconeBola } from "./icons";

// A bola confirmando a presença.
//
// Quem desenha é esta camada, montada UMA vez no layout, e não o botão que
// disparou. Não é preciosismo: em /fut/[id] confirmar presença faz o próprio
// botão "Vou" sair da árvore (a página só o renderiza para quem ainda não está
// na lista), então um efeito hospedado dentro dele seria desmontado antes de
// chegar a rodar. O botão só avisa; o desenho mora fora do alcance da troca.

// O `saida` do contêiner é o mais longo (.80s) e é ele que apaga o conjunto, então
// o corte tem que cair logo depois de ele terminar. Por setTimeout, e não por
// `animationend`: assim a camada se desmonta mesmo se um keyframe não chegar a
// disparar.
const DURACAO_MS = 820;

/**
 * A fonte única de "as animações estão ligadas".
 *
 * Lê o `--mov` que o globals.css resolve a partir do `data-motion` (cookie) e do
 * `prefers-reduced-motion`. Reimplementar essa precedência aqui em JavaScript
 * seria manter a mesma regra em dois lugares — e o dia em que os dois
 * discordassem, a pessoa que desligou as animações veria uma.
 */
export function movimentoLigado(): boolean {
  if (typeof document === "undefined") return false;
  return getComputedStyle(document.documentElement).getPropertyValue("--mov").trim() !== "0";
}

/** Avisa a camada. Silencioso quando não há o que comemorar. */
export function dispararComemoracao(caixa: CaixaDoAlvo | null, tom: TomDaComemoracao) {
  if (typeof window === "undefined") return;
  // Aba em segundo plano: a animação rodaria para ninguém, e o rAF do browser
  // está congelado de qualquer jeito.
  if (document.visibilityState !== "visible") return;
  if (!movimentoLigado()) return;

  const ponto = pontoDaComemoracao(caixa, {
    width: window.innerWidth,
    height: window.innerHeight,
  });

  // Microtask porque o disparo sai do cleanup de um efeito, ou seja, de dentro
  // do commit do React. Despachar ali seria pedir setState à camada no meio da
  // desmontagem de outra árvore.
  queueMicrotask(() => {
    window.dispatchEvent(
      new CustomEvent<Comemoracao>(EVENTO_COMEMORACAO, { detail: { ...ponto, tom } }),
    );
  });
}

/**
 * O gancho no botão. Devolve o `ref` que precisa chegar ao <button>.
 *
 * Comemora TERMINAR NÃO É COMEMORAR DAR CERTO, e a diferença importa: o
 * `setMyAttendance` volta em silêncio em cinco caminhos (jogador inativo, fut
 * inexistente, lista já fechada, não elegível, e o mesmo teste refeito na linha
 * travada). Em todos eles o `pending` sobe e desce igualzinho, e a versão que
 * só olhava o pending festejava uma confirmação que não aconteceu — o caso real
 * é quem tem a home aberta quando o sorteio fecha a lista.
 *
 * São dois sinais de sucesso, um por caminho:
 *
 *  - `quando` MUDOU — a home, onde o botão sobrevive à action. É o estado que a
 *    action deveria ter mexido; igual no fim significa que ela não mexeu.
 *  - o botão DESMONTOU — /fut/[id], onde confirmar presença tira o próprio
 *    botão da árvore. Ali a desmontagem é a prova: a action que não faz nada
 *    devolve a mesma tela, com o botão no lugar.
 *
 * A caixa é lida quando o pending SOBE, enquanto o botão ainda existe para ser
 * medido.
 */
export function useComemoracaoAoTerminar(
  tom: TomDaComemoracao | undefined,
  pending: boolean,
  quando?: string,
) {
  const ref = useRef<HTMLButtonElement>(null);
  const emVoo = useRef<{ caixa: CaixaDoAlvo | null; antes: string | undefined } | null>(null);
  const tomAtual = useRef(tom);

  useEffect(() => {
    tomAtual.current = tom;
    if (!tom) return;

    if (pending) {
      const r = ref.current?.getBoundingClientRect();
      emVoo.current = {
        caixa: r ? { left: r.left, top: r.top, width: r.width, height: r.height } : null,
        antes: quando,
      };
      return;
    }

    // Pending caiu com o botão vivo: só festeja se o estado mudou de verdade.
    const voo = emVoo.current;
    if (!voo) return;
    emVoo.current = null;
    if (voo.antes !== quando) dispararComemoracao(voo.caixa, tom);
  }, [tom, pending, quando]);

  // Efeito separado, e de desmontagem só, porque o de cima não roda mais depois
  // que o botão sai da árvore — e é exatamente ali que mora o sucesso do
  // /fut/[id]. `emVoo` preenchido na hora da desmontagem quer dizer que havia um
  // submit em voo, e que a tela que voltou não tem mais este botão.
  useEffect(
    () => () => {
      const voo = emVoo.current;
      if (voo && tomAtual.current) dispararComemoracao(voo.caixa, tomAtual.current);
    },
    [],
  );

  return ref;
}

// O tom nomeia O QUE FICA EMBAIXO DA BOLA quando ela é desenhada, e não a
// variante do botão que disparou. A distinção não é preciosismo: os dois casos
// do app são `primary` no clique e caem em fundos opostos — na home a bola
// pousa no próprio botão, que a essa altura é lime cheio; em /fut/[id] o botão
// já saiu da árvore e ela pousa na surface da página. Deduzir o tom da variante
// acertava os dois no tema claro e errava os dois no escuro, onde `accent-ink`
// e `accent` são o mesmo #CDFF3A e `on-accent` é quase a cor da surface.
const tintas: Record<TomDaComemoracao, string> = {
  // Sobre canvas ou surface. `accent` puro como traço aqui daria 1,4:1 no tema
  // claro — a mesma razão que parte o lime em dois papéis no globals.css.
  padrao: "text-accent-ink",
  // Em cima de lime cheio: no tema escuro `accent-ink` e `accent` colapsam no
  // mesmo valor e a bola sumiria.
  "sobre-accent": "text-on-accent",
};

/**
 * Mora no layout, filho direto do <body> — fora do <div> que contém a TabBar.
 *
 * ARMADILHA, a mesma que o tab-bar.tsx documenta: a nav é `fixed`, e qualquer
 * ancestral dela com `transform` vira o bloco contentor do `fixed` e traz de
 * volta o bug do quique no iOS. Esta camada TEM transform (o -translate de
 * centralização). Ficando fora daquele <div>, o único ancestral comum entre as
 * duas é o <body>, que não ganha transform nenhum — e é isso que mantém a
 * armadilha fechada. Há um assert de e2e guardando exatamente isto.
 */
export function CamadaDeComemoracao() {
  const [atual, setAtual] = useState<(Comemoracao & { seq: number }) | null>(null);

  useEffect(() => {
    let seq = 0;
    const aoComemorar = (evento: Event) => {
      // O `dispararComemoracao` já filtra, e mesmo assim confere-se aqui: quem
      // DESENHA é esta camada, e ela é o último ponto em que ainda dá para não
      // desenhar. Sem isto, qualquer outro emissor do evento que apareça um dia
      // passa por cima da escolha da pessoa em /perfil.
      if (!movimentoLigado()) return;
      setAtual({ ...(evento as CustomEvent<Comemoracao>).detail, seq: ++seq });
    };
    window.addEventListener(EVENTO_COMEMORACAO, aoComemorar);
    return () => window.removeEventListener(EVENTO_COMEMORACAO, aoComemorar);
  }, []);

  useEffect(() => {
    if (!atual) return;
    const t = setTimeout(() => setAtual(null), DURACAO_MS);
    return () => clearTimeout(t);
  }, [atual]);

  if (!atual) return null;

  return (
    <span
      // `key` pelo contador: sem ele, duas confirmações seguidas reaproveitariam
      // o mesmo nó e a segunda animação não chegaria a começar — keyframe não
      // reinicia em elemento que persiste.
      key={atual.seq}
      // aria-hidden e sem live region própria: quem anuncia o resultado é o
      // aria-live que o Button já carrega, e o rótulo dele que muda. Decoração
      // não disputa aquele canal.
      aria-hidden
      data-comemoracao
      className={cx(
        "pointer-events-none fixed z-40 grid size-14 -translate-x-1/2 -translate-y-1/2 place-items-center opacity-0 animate-saida",
        // z-40 passa por cima da TabBar e da TopBar (z-30) e fica abaixo do
        // popover do seletor, que vai para o top layer e dispensa z-index.
        // pointer-events-none é o que impede a camada de roubar o clique
        // seguinte — sem isso os specs de e2e travariam no actionability.
        tintas[atual.tom],
      )}
      style={{ left: atual.x, top: atual.y }}
    >
      <span className="col-start-1 row-start-1 size-14 rounded-full border-2 border-current opacity-0 animate-aro" />
      <IconeBola className="col-start-1 row-start-1 size-9 animate-rolagem [stroke-width:2]" />
    </span>
  );
}
