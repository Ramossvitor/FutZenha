"use client";

import { useEffect, useRef, useState } from "react";
import { IconeCarregando, IconeCheck, IconeSeta } from "@/components/ui/icons";
import { cx } from "@/lib/cx";
import { armado, ATIVACAO, ehPuxadaParaBaixo, LIMIAR, opacidade, resistencia } from "./puxada";
import { ROTULO, useAtualizacao } from "./use-atualizacao";

/** O mesmo `lg` do Tailwind em que a TopBar some e a lateral aparece. */
const DESKTOP = "(min-width: 64rem)";

/**
 * Puxar-para-atualizar: o disparo do celular.
 *
 * Mora dentro do <header> da TopBar, que é `sticky top-0` e `lg:hidden` — daí a
 * pílula sair de `top-full` sem precisar de variável de altura nova, e daí o
 * componente não existir no desktop (lá o caminho é o botao-atualizar.tsx).
 *
 * O CONTEÚDO DA PÁGINA NÃO SE MEXE. Quem segue o dedo é só a pílula. Arrastar o
 * conteúdo exigiria `transform` num elemento do fluxo, e ancestral com transform
 * vira bloco contentor de `fixed`: é o bug do quique da TabBar no iOS, documentado
 * no tab-bar.tsx e no layout.tsx, e travado por e2e/tab-bar.spec.ts. Um transform
 * no <main> ainda quebraria o `sticky bottom-[var(--tabbar-h)]` que vive dentro
 * dele (avaliar/[id]/rating-form.tsx). O <header> aqui é IRMÃO da TabBar, então a
 * pílula pode ter transform à vontade.
 */
export function PuxarParaAtualizar() {
  const { atualizar, estado } = useAtualizacao();
  const [deslocamento, setDeslocamento] = useState(0);

  // Os handlers de toque são instalados uma vez e vivem fora do ciclo de render;
  // sem estes espelhos eles enxergariam para sempre o primeiro `estado`.
  const estadoRef = useRef(estado);
  const atualizarRef = useRef(atualizar);
  useEffect(() => {
    estadoRef.current = estado;
    atualizarRef.current = atualizar;
  });

  // `overscroll-behavior` pelo JS e não pelo globals.css de propósito: se o
  // bundle não carregar, o Android Chrome mantém o pull-to-refresh nativo dele
  // em vez de o app ficar sem nenhum dos dois. `contain` só no celular — no
  // desktop isso apagaria o quique do macOS sem nada em troca; lá vai `auto`,
  // que é o valor default (nada visível muda) e dá ao e2e um sinal de
  // hidratação nos dois breakpoints (o esperarOGesto do atualizar.spec.ts).
  useEffect(() => {
    const consulta = window.matchMedia(DESKTOP);
    const raiz = document.documentElement;
    const sincronizar = () => {
      raiz.style.overscrollBehaviorY = consulta.matches ? "auto" : "contain";
    };
    sincronizar();
    consulta.addEventListener("change", sincronizar);
    return () => {
      consulta.removeEventListener("change", sincronizar);
      raiz.style.overscrollBehaviorY = "";
    };
  }, []);

  useEffect(() => {
    let origem: { x: number; y: number } | null = null;
    let eixoDecidido = false;
    let engatado = false;
    let atual = 0;

    function soltarEscutas() {
      document.removeEventListener("touchmove", aoMover);
      document.removeEventListener("touchend", aoSoltar);
      document.removeEventListener("touchcancel", aoAbortar);
    }

    function zerar() {
      origem = null;
      eixoDecidido = false;
      engatado = false;
      atual = 0;
      soltarEscutas();
      setDeslocamento(0);
    }

    function aoComecar(evento: TouchEvent) {
      // A consulta é feita AQUI, e não na montagem, para o gesto acertar mesmo
      // se a janela cruzar o breakpoint depois — sem custo de listener extra.
      if (window.matchMedia(DESKTOP).matches) return;
      // A trava dos 5s: durante ela o gesto simplesmente não engata.
      if (estadoRef.current !== "parado") return;
      // Pinça não é puxada.
      if (evento.touches.length !== 1) return;
      // Só no topo do documento — o scroll aqui é do documento (o body é
      // `min-h-full`, não `h-full`).
      if (window.scrollY > 0) return;
      // O seletor de grupo fica no top layer com a página rolando atrás. A
      // guarda de suporte vem antes porque pseudo-classe desconhecida faz o
      // querySelector LANÇAR (Safari < 17) — e sem a API não há popover aberto.
      const haPopover =
        "popover" in HTMLElement.prototype &&
        document.querySelector("[popover]:popover-open");
      if (haPopover) return;

      const toque = evento.touches[0];
      origem = { x: toque.clientX, y: toque.clientY };
      eixoDecidido = false;
      engatado = false;
      atual = 0;
      // Não-passivo porque precisa de preventDefault, e só a partir de um
      // touchstart que qualificou: pendurar listener não-passivo em toda rolagem
      // do app é justamente o que tira o browser do caminho rápido.
      document.addEventListener("touchmove", aoMover, { passive: false });
      document.addEventListener("touchend", aoSoltar);
      document.addEventListener("touchcancel", aoAbortar);
    }

    function aoMover(evento: TouchEvent) {
      if (!origem) return;
      if (evento.touches.length !== 1) {
        zerar();
        return;
      }
      const toque = evento.touches[0];
      const dx = toque.clientX - origem.x;
      const dy = toque.clientY - origem.y;

      if (!eixoDecidido) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < ATIVACAO) return;
        eixoDecidido = true;
        engatado = ehPuxadaParaBaixo(dx, dy);
        // Deslize lateral (a faixa de abas dos rankings) ou rolagem para cima:
        // devolve o gesto ao browser e não volta a olhar para ele.
        if (!engatado) {
          zerar();
          return;
        }
      }

      // Voltou acima da origem no meio do gesto: recolhe a pílula, mas mantém o
      // engate — a pessoa ainda pode puxar de novo sem levantar o dedo.
      if (dy <= 0) {
        atual = 0;
        setDeslocamento(0);
        return;
      }

      // Depois que o browser assume a rolagem, o touchmove chega não-cancelável
      // e o preventDefault só renderia um aviso no console.
      if (evento.cancelable) evento.preventDefault();
      atual = resistencia(dy);
      setDeslocamento(atual);
    }

    function aoSoltar(evento: TouchEvent) {
      // Sobrou dedo na tela: multi-toque, e a regra da pinça manda cancelar. É
      // o par do `touches.length !== 1` do aoMover, que sozinho não cobre um
      // segundo dedo que encosta e levanta sem mover — sem esta guarda, esse
      // touchend dispararia o refresh com o dedo principal ainda puxando.
      if (evento.touches.length > 0) {
        zerar();
        return;
      }
      const dispara = engatado && armado(atual);
      zerar();
      if (dispara) atualizarRef.current();
    }

    function aoAbortar() {
      zerar();
    }

    document.addEventListener("touchstart", aoComecar, { passive: true });
    return () => {
      document.removeEventListener("touchstart", aoComecar);
      soltarEscutas();
    };
  }, []);

  const arrastando = estado === "parado" && deslocamento > 0;
  const y = estado === "parado" ? deslocamento : LIMIAR;
  const alfa = estado === "parado" ? opacidade(deslocamento) : 1;
  const pronto = armado(deslocamento);
  // Só para o e2e e para depurar: as cinco fases num atributo só. Sem ele, a
  // única forma de um teste ver "armado" seria medir a rotação da seta.
  const fase =
    estado !== "parado" ? estado : !arrastando ? "parado" : pronto ? "armado" : "puxando";

  return (
    <div
      // Região viva SEMPRE presente, e não criada quando o estado muda: live
      // region que nasce junto com o conteúdo não é anunciada (o porquê está por
      // extenso em ui/button.tsx). Só "Atualizando…" e "Atualizado" têm texto —
      // narrar cada pixel de arrasto seria tagarelice.
      role="status"
      aria-live="polite"
      data-puxada={fase}
      className={cx(
        "pointer-events-none absolute top-full left-1/2 flex min-h-9 items-center gap-2",
        "rounded-full border border-line bg-surface px-3",
        "font-display text-[12px] font-semibold font-stretch-112% text-fg-2",
        // Sem transição enquanto o dedo manda: ela atrasaria a pílula em relação
        // ao toque. Na volta e no encaixe, sim. Movimento reduzido derruba a
        // duração para .01ms sozinho, via globals.css.
        !arrastando && "transition-[translate,opacity] duration-200",
      )}
      style={{ translate: `-50% ${y}px`, opacity: alfa }}
    >
      {estado === "atualizando" ? (
        <IconeCarregando className="size-[18px] shrink-0 animate-spin" />
      ) : estado === "concluido" ? (
        <IconeCheck className="size-[18px] shrink-0" />
      ) : (
        // Manipulação direta por `style`, não animação: continua respondendo ao
        // dedo mesmo com as animações desligadas.
        <IconeSeta
          className="size-[18px] shrink-0 transition-[rotate] duration-150"
          style={{ rotate: pronto ? "-90deg" : "90deg" }}
        />
      )}
      {estado !== "parado" && <span>{ROTULO[estado]}</span>}
    </div>
  );
}
