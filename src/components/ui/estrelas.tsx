import { Fragment } from "react";
import { cx } from "@/lib/cx";

const NOTAS = [1, 2, 3, 4, 5] as const;

/** Como o produto fala de cada nota. */
export const ROTULO_DA_NOTA: Record<number, string> = {
  1: "jogou de terno",
  2: "tem dias melhores",
  3: "fez o feijão com arroz",
  4: "jogou muito",
  5: "estava impossível",
};

// SVG e não o caractere ★: em parte dos aparelhos o glifo vem com apresentação
// de emoji (amarelo, colorido, ignorando o `color`), e o tamanho muda conforme
// a fonte que carregou. Um path não muda de ideia.
function Estrela({ className }: { className?: string }) {
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
 * As estrelas recebidas, só leitura.
 */
export function Estrelas({
  valor,
  de = 5,
  className,
}: {
  valor: number;
  de?: number;
  className?: string;
}) {
  return (
    <span className={cx("inline-flex items-center gap-0.5", className)}>
      <span className="sr-only">
        {valor} de {de} estrelas
      </span>
      {Array.from({ length: de }, (_, i) => (
        <span
          key={i}
          aria-hidden
          className={cx("size-4", i < valor ? "text-accent-ink" : "text-line-strong")}
        >
          <Estrela />
        </span>
      ))}
    </span>
  );
}

/**
 * O seletor de 1 a 5 estrelas, sem uma linha de JavaScript.
 *
 * O truque é o DOM invertido (5 → 1) somado a `flex-row-reverse`, que devolve a
 * ordem visual. Como o combinador `~` do `peer-checked` só alcança irmãos
 * POSTERIORES, marcar a terceira estrela pinta a terceira, a segunda e a
 * primeira — que é o preenchimento cumulativo que se espera de uma nota.
 *
 * O código anterior prometia isso num comentário mas nunca fez: cada par
 * input+label estava embrulhado no próprio <span>, e `~` não atravessa
 * elemento pai. Na prática acendia só a estrela clicada, solta no meio das
 * apagadas. Por isso os dez elementos aqui são irmãos diretos.
 */
export function EstrelasInput({
  name,
  legenda,
  valorPadrao,
  className,
}: {
  name: string;
  legenda: string;
  valorPadrao?: number;
  className?: string;
}) {
  return (
    // `justify-end` com `flex-row-reverse` alinha à ESQUERDA: o eixo principal
    // corre da direita para a esquerda, então o fim dele é a borda esquerda.
    <fieldset className={cx("flex flex-row-reverse items-center justify-end", className)}>
      <legend className="sr-only">{legenda}</legend>
      {[...NOTAS].reverse().map((n) => (
        // Fragment sem nó no DOM: os dez elementos precisam ser irmãos diretos
        // para o `~` do peer-checked alcançá-los.
        <Fragment key={n}>
          <input
            type="radio"
            id={`${name}-${n}`}
            name={name}
            value={n}
            defaultChecked={valorPadrao === n}
            required
            className="peer sr-only"
          />
          <label
            htmlFor={`${name}-${n}`}
            title={`${n} ${n === 1 ? "estrela" : "estrelas"} — ${ROTULO_DA_NOTA[n]}`}
            // p-1 dá 40px de alvo com a estrela de 32px, dentro do mínimo de toque
            className="cursor-pointer p-1 text-line-strong transition-colors peer-checked:text-accent-ink peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring"
          >
            <span className="block size-8">
              <Estrela />
            </span>
            <span className="sr-only">
              {n} {n === 1 ? "estrela" : "estrelas"}
            </span>
          </label>
        </Fragment>
      ))}
    </fieldset>
  );
}
