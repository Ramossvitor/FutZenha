"use client";

import { useActionState } from "react";
import { denunciarAvaliacao, type DenunciarState } from "./actions";

const initialState: DenunciarState = {};

export function DenunciarForm({ roundId, indice }: { roundId: number; indice: number }) {
  const [state, formAction, pending] = useActionState(
    denunciarAvaliacao.bind(null, roundId, indice),
    initialState,
  );

  if (state.success) {
    return (
      <p className="text-xs text-emerald-700 dark:text-emerald-400">
        Denúncia enviada. O admin da plataforma tem 3 dias para responder.
      </p>
    );
  }

  return (
    <details className="w-full">
      <summary className="cursor-pointer text-xs text-neutral-500 hover:underline">
        reportar esta nota
      </summary>
      <form action={formAction} className="mt-2 flex flex-col gap-2">
        <textarea
          name="reason"
          rows={2}
          maxLength={500}
          placeholder="Por que você acha que esta nota foi injusta? (opcional)"
          className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-emerald-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
        />
        {state.error && <p className="text-xs text-red-600">{state.error}</p>}
        <button
          type="submit"
          disabled={pending}
          className="self-start rounded-lg border border-red-300 px-3 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-60 dark:border-red-800 dark:hover:bg-red-950"
        >
          {pending ? "Enviando..." : "Reportar"}
        </button>
      </form>
    </details>
  );
}
