import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { cx } from "@/lib/cx";

// Havia quatro strings de input divergentes espalhadas por nove arquivos —
// umas com text-sm, outra com foco vermelho, outra sem cor de texto. Agora é
// uma só, e o foco sai do :focus-visible global do globals.css.

const controle =
  "w-full rounded-ctl border border-line-strong bg-surface px-3 text-[14px] text-fg " +
  "placeholder:text-fg-dim outline-none transition-colors " +
  "focus:border-accent-edge disabled:opacity-55 " +
  "aria-[invalid=true]:border-danger-line";

/** Rótulo + controle + ajuda/erro. O `htmlFor` é obrigatório de propósito. */
export function Field({
  htmlFor,
  label,
  ajuda,
  erro,
  obrigatorio = false,
  className,
  children,
}: {
  htmlFor: string;
  label: ReactNode;
  ajuda?: ReactNode;
  erro?: ReactNode;
  obrigatorio?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="font-display text-[12px] font-semibold text-fg-2">
        {label}
        {obrigatorio && (
          <span aria-hidden className="text-danger-ink">
            {" "}
            *
          </span>
        )}
      </label>
      {children}
      {erro ? (
        <p className="text-[12px] text-danger-ink">{erro}</p>
      ) : (
        ajuda && <p className="text-[12px] text-fg-4">{ajuda}</p>
      )}
    </div>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={cx(controle, "h-10", className)} />;
}

export function Select({
  className,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>) {
  // Sem seta customizada: o `color-scheme` do globals.css já faz o widget
  // nativo vir no tema certo, e o nativo é o que funciona bem no mobile.
  return (
    <select {...rest} className={cx(controle, "h-10", className)}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={cx(controle, "min-h-20 py-2 leading-[1.5]", className)} />;
}

/**
 * Grupo de rádios em caixa, sem uma linha de JavaScript.
 *
 * O `peer` alcança o irmão seguinte, então o input vem antes do label e o
 * `peer-checked:` pinta a caixa inteira.
 */
export function RadioGroup({
  name,
  legenda,
  opcoes,
  valorPadrao,
  className,
}: {
  name: string;
  legenda: ReactNode;
  opcoes: { valor: string; titulo: ReactNode; descricao?: ReactNode }[];
  valorPadrao?: string;
  className?: string;
}) {
  return (
    <fieldset className={cx("flex flex-col gap-1.5", className)}>
      <legend className="mb-1.5 font-display text-[12px] font-semibold text-fg-2">
        {legenda}
      </legend>
      <div className="flex flex-col gap-2">
        {opcoes.map((o) => {
          const id = `${name}-${o.valor}`;
          return (
            <div key={o.valor} className="relative">
              <input
                type="radio"
                id={id}
                name={name}
                value={o.valor}
                defaultChecked={valorPadrao === o.valor}
                className="peer sr-only"
              />
              <label
                htmlFor={id}
                className="flex cursor-pointer flex-col gap-0.5 rounded-ctl border border-line-strong bg-surface px-3.5 py-2.5 transition-colors hover:border-line-hover peer-checked:border-accent-edge peer-checked:bg-accent-tint peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring"
              >
                <span className="font-display text-[14px] font-semibold text-fg">{o.titulo}</span>
                {o.descricao && (
                  <span className="text-[12.5px] leading-[1.45] text-fg-3">{o.descricao}</span>
                )}
              </label>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
