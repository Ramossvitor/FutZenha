"use client";

import { useActionState } from "react";
import { enviarAvaliacoes, type AvaliarState } from "./actions";

const initialState: AvaliarState = {};

export type CompanheiroForm = {
  playerId: number;
  rotulo: string;
  isGoalkeeper: boolean;
  estrelasAtuais?: number;
};

const ESTRELAS = [1, 2, 3, 4, 5] as const;

export function RatingForm({
  roundId,
  companheiros,
  jaEnviou,
}: {
  roundId: number;
  companheiros: CompanheiroForm[];
  jaEnviou: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    enviarAvaliacoes.bind(null, roundId),
    initialState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-3">
      {companheiros.map((c) => (
        <fieldset
          key={c.playerId}
          className="flex flex-wrap items-center gap-2 rounded-xl border border-neutral-200 bg-white p-3 shadow-sm dark:border-neutral-800 dark:bg-neutral-900"
        >
          <legend className="sr-only">Nota de {c.rotulo}</legend>
          <span className="font-medium">
            {c.isGoalkeeper ? "🧤 " : ""}
            {c.rotulo}
          </span>
          <div className="ml-auto flex gap-1">
            {ESTRELAS.map((n) => (
              <span key={n}>
                {/* radio escondido + label clicável: dá estrela sem uma linha
                    de JavaScript, e o peer-checked pinta da 1ª até a marcada
                    porque as seguintes vêm depois no DOM. */}
                <input
                  type="radio"
                  id={`estrelas-${c.playerId}-${n}`}
                  name={`estrelas-${c.playerId}`}
                  value={n}
                  defaultChecked={c.estrelasAtuais === n}
                  required
                  className="peer sr-only"
                />
                <label
                  htmlFor={`estrelas-${c.playerId}-${n}`}
                  title={`${n} ${n === 1 ? "estrela" : "estrelas"}`}
                  className="cursor-pointer text-2xl leading-none text-neutral-300 transition-colors hover:text-amber-300 peer-checked:text-amber-400 peer-focus-visible:outline peer-focus-visible:outline-emerald-600 dark:text-neutral-600"
                >
                  ★
                </label>
              </span>
            ))}
          </div>
        </fieldset>
      ))}

      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state.success && (
        <p className="text-sm text-emerald-700 dark:text-emerald-400">
          Avaliação enviada! Dá para mudar enquanto o prazo não acabar.
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-lg bg-emerald-700 px-4 py-2 font-medium text-white hover:bg-emerald-800 disabled:opacity-60"
      >
        {pending ? "Enviando..." : jaEnviou ? "Atualizar avaliação" : "Enviar avaliação"}
      </button>
    </form>
  );
}
