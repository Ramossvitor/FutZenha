"use client";

import { Fragment, useRef, useState } from "react";
import { Estrela } from "@/components/ui/estrelas";
import { cx } from "@/lib/cx";
import { formatMeias, rotuloDeEstrelas } from "@/lib/format";

// DOM invertido (10 → 1): ver o comentário do componente.
const MEIAS = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1] as const;

// Movimento horizontal mínimo antes de o gesto virar arrasto. Sem a folga, o
// tremor natural do dedo no touchstart marcaria uma nota em quem só queria
// rolar a lista — o toque parado continua sendo trabalho do <label> nativo.
const FOLGA_DO_ARRASTO = 8;

/**
 * O seletor de nota em meias-estrelas (1..10, onde 7 = 3,5★).
 *
 * A base é a mesma do seletor antigo, agora com dez rádios: DOM invertido
 * (10 → 1) somado a `flex-row-reverse`, porque o combinador `~` do
 * `peer-checked` só alcança irmãos POSTERIORES — marcar 7 pinta 7, 6, …, 1,
 * que é o preenchimento cumulativo de 3,5 estrelas. Os vinte elementos
 * precisam ser irmãos diretos (Fragment), senão o `~` não atravessa.
 *
 * Cada <label> é MEIA estrela: uma janela de 24×48px com overflow escondido
 * mostrando a metade correspondente de um glifo de 40px. As metades são
 * adjacentes, nunca sobrepostas — sobrepor exigiria z-index e quebraria o
 * `~` do hover preview.
 *
 * Três camadas de interação, da mais robusta para a mais rica:
 * - Toque/clique na metade: <label> nativo. É o que funciona SEM JavaScript,
 *   com `required`, teclado (setas percorrem os dez valores) e reenvio
 *   pré-preenchido de graça.
 * - Hover preview (desktop): CSS puro no strip, em três regras de
 *   especificidade crescente. O `peer-checked` do Tailwind v4 compila com
 *   `:where()` e fica em (0,2,0), então o reset `[&:hover>label]` (0,2,1) já
 *   o vence, e a faixa sob o mouse (0,3,1) vence o reset. Sem seletor de
 *   atributo dentro do variant — colchete aninhado o Tailwind não gera.
 * - Arrasto: pointer events no strip marcam o rádio da posição do dedo/mouse,
 *   imperativamente. Os rádios seguem não-controlados — o submit lê o DOM.
 *
 * `touch-pan-y`: arrasto horizontal é nota, vertical é scroll da página (o
 * browser assume e emite pointercancel, que encerra o gesto limpo). A tela de
 * votação é uma lista rolável — `touch-action: none` sequestraria o scroll de
 * quem encosta numa fileira de estrelas.
 *
 * A animação `animate-pulo` vai no <span> interno absoluto e NUNCA no label:
 * a caixa do label é o alvo de toque, e escalar o alvo faria o Playwright
 * esperar a bounding box assentar entre os cliques do avaliar.spec. Pelo mesmo
 * motivo o mostrador numérico tem largura fixa — o texto mudar não move o strip.
 */
export function EstrelasInput({
  name,
  legenda,
  valorPadrao,
  aoEscolher,
  className,
}: {
  name: string;
  legenda: string;
  /** Em meias-estrelas (1..10). */
  valorPadrao?: number;
  /** Avisa quem está por cima que uma nota foi escolhida — a tela conta
   *  quantas já foram dadas. O valor também alimenta o mostrador local. */
  aoEscolher?: (meias: number) => void;
  className?: string;
}) {
  const [meias, setMeias] = useState<number | undefined>(valorPadrao);
  const strip = useRef<HTMLDivElement>(null);
  const gesto = useRef<{ x: number; y: number; arrastando: boolean } | null>(null);

  const notificar = (v: number) => {
    setMeias(v);
    aoEscolher?.(v);
  };

  // Marca o rádio da posição durante o arrasto — com `.click()`, e NUNCA com
  // `.checked = true`. Setar a propriedade passa pelo value tracker do React,
  // que então engole o próximo clique de verdade no mesmo rádio como
  // duplicata: o fill marcava, mas o onChange (e o mostrador) não vinham. O
  // clique programático é ativação nativa — dispara o change e cai no mesmo
  // onChange do toque. No fim do gesto, o clique que o browser gera sozinho
  // encontra o rádio já marcado e não muda nada.
  const marcar = (v: number) => {
    const input = document.getElementById(`${name}-${v}`);
    if (input instanceof HTMLInputElement && !input.checked) input.click();
  };

  const valorNoPonto = (clientX: number) => {
    const rect = strip.current!.getBoundingClientRect();
    const fracao = (clientX - rect.left) / rect.width;
    return Math.min(10, Math.max(1, Math.ceil(fracao * 10)));
  };

  return (
    <fieldset className={cx("flex items-center gap-3", className)}>
      <legend className="sr-only">{legenda}</legend>
      <div
        ref={strip}
        onPointerDown={(e) => {
          if (e.pointerType === "mouse" && e.button !== 0) return;
          gesto.current = { x: e.clientX, y: e.clientY, arrastando: false };
        }}
        onPointerMove={(e) => {
          const g = gesto.current;
          if (!g) return;
          // Ponteiro sem contato: mouse que soltou o botão fora do strip, ou
          // caneta pairando. Nenhum dos dois tem captura implícita (só touch
          // tem), então o pointerup pode cair fora e nunca chegar aqui — e
          // caneta com hover emite move sem contato, que marcaria nota sozinha.
          if (e.buttons === 0) {
            gesto.current = null;
            return;
          }
          if (!g.arrastando) {
            const dx = Math.abs(e.clientX - g.x);
            const dy = Math.abs(e.clientY - g.y);
            // Intenção horizontal: passou a folga E anda mais para o lado do
            // que para cima/baixo. Vertical de verdade vira scroll (pan-y) e
            // o browser cancela o pointer antes de chegar aqui de novo.
            if (dx < FOLGA_DO_ARRASTO || dx <= dy) return;
            g.arrastando = true;
          }
          marcar(valorNoPonto(e.clientX));
        }}
        onPointerUp={() => {
          gesto.current = null;
        }}
        onPointerCancel={() => {
          gesto.current = null;
        }}
        className={cx(
          "flex flex-row-reverse items-center justify-end select-none touch-pan-y rounded-ctl",
          "has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-ring",
          // O hover preview em três regras (ver o comentário do componente):
          // apaga tudo, e reacende só até a metade sob o mouse.
          "[&:hover>label]:text-line-strong",
          "[&:hover>label:hover]:text-accent-ink",
          "[&:hover>label:hover~label]:text-accent-ink",
        )}
      >
        {MEIAS.map((v) => (
          <Fragment key={v}>
            <input
              type="radio"
              id={`${name}-${v}`}
              name={name}
              value={v}
              defaultChecked={valorPadrao === v}
              required
              onChange={() => notificar(v)}
              className="peer sr-only"
            />
            <label
              htmlFor={`${name}-${v}`}
              title={rotuloDeEstrelas(v)}
              // Janela de 24×48px — alvo de toque de meia estrela. O glifo de
              // 40px fica 4px afastado da borda externa da própria estrela,
              // então estrelas vizinhas abrem 8px entre si.
              className={cx(
                "relative h-12 w-6 cursor-pointer overflow-hidden text-line-strong transition-colors",
                "peer-checked:text-accent-ink peer-checked:[&>span:first-child]:animate-pulo",
              )}
            >
              <span
                aria-hidden
                className={cx(
                  "absolute inset-y-1 block size-10",
                  // Ímpar é a metade esquerda da estrela (glifo encostado à
                  // esquerda da janela); par, a direita (glifo deslocado para
                  // a janela mostrar só o fim dele).
                  v % 2 ? "left-1" : "-left-5",
                )}
              >
                <Estrela />
              </span>
              <span className="sr-only">{rotuloDeEstrelas(v)}</span>
            </label>
          </Fragment>
        ))}
      </div>
      {/* aria-hidden: quem usa leitor de tela já ouve o valor pelo rádio. */}
      <span
        aria-hidden
        data-num
        className="w-7 shrink-0 text-right font-display text-[15px] font-extrabold text-fg"
      >
        {meias !== undefined ? formatMeias(meias) : ""}
      </span>
    </fieldset>
  );
}
