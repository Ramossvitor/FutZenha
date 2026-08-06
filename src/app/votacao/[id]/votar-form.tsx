"use client";

import { useActionState } from "react";
import { votar, type VotarState } from "./actions";

const initialState: VotarState = {};

export function VotarForm({ voteId }: { voteId: number }) {
  const [state, formAction, pending] = useActionState(votar.bind(null, voteId, true), initialState);
  const [stateNao, formActionNao, pendingNao] = useActionState(
    votar.bind(null, voteId, false),
    initialState,
  );
  const erro = state.error ?? stateNao.error;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <form action={formAction}>
          <button
            type="submit"
            disabled={pending || pendingNao}
            className="rounded-lg bg-red-700 px-4 py-2 font-medium text-white hover:bg-red-800 disabled:opacity-60"
          >
            {pending ? "Registrando..." : "Sim, apagar a pelada"}
          </button>
        </form>
        <form action={formActionNao}>
          <button
            type="submit"
            disabled={pending || pendingNao}
            className="rounded-lg border border-neutral-300 px-4 py-2 font-medium hover:bg-neutral-100 disabled:opacity-60 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            {pendingNao ? "Registrando..." : "Não, manter"}
          </button>
        </form>
      </div>
      {erro && <p className="text-sm text-red-600">{erro}</p>}
    </div>
  );
}
