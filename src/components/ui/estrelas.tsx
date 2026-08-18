import { cx } from "@/lib/cx";
import { rotuloDeEstrelas } from "@/lib/format";

// SVG e não o caractere ★: em parte dos aparelhos o glifo vem com apresentação
// de emoji (amarelo, colorido, ignorando o `color`), e o tamanho muda conforme
// a fonte que carregou. Um path não muda de ideia.
export function Estrela({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cx("size-full", className)}>
      <path
        fill="currentColor"
        d="M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.4-5.8-3-5.8 3 1.1-6.4L2.6 9.4l6.5-.9z"
      />
    </svg>
  );
}

/**
 * As estrelas recebidas, só leitura. `meias` é em meias-estrelas (1..10):
 * valor ímpar acende meia estrela — um overlay de 50% com overflow escondido
 * por cima da estrela apagada.
 */
export function Estrelas({ meias, className }: { meias: number; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-0.5", className)}>
      <span className="sr-only">{rotuloDeEstrelas(meias)} de 5 estrelas</span>
      {[1, 2, 3, 4, 5].map((s) => (
        <span
          key={s}
          aria-hidden
          className={cx(
            "relative size-4",
            meias >= s * 2 ? "text-accent-ink" : "text-line-strong",
          )}
        >
          <Estrela />
          {meias === s * 2 - 1 && (
            <span className="absolute inset-y-0 left-0 w-1/2 overflow-hidden text-accent-ink">
              {/* 200% da metade = 100% da célula: escala com o size-* que o
                  histograma do perfil impõe de fora, sem tamanho fixo aqui. */}
              <span className="block h-full w-[200%]">
                <Estrela />
              </span>
            </span>
          )}
        </span>
      ))}
    </span>
  );
}
