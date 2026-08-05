"use client";

import { useActionState } from "react";
import { claimInvite, type ClaimState } from "./actions";

const initialState: ClaimState = {};

const inputClass =
  "rounded-lg border border-neutral-300 bg-white px-3 py-2 text-neutral-900 outline-none focus:border-emerald-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100";

export function ClaimForm({
  token,
  existingUsername,
  suggestedUsername,
}: {
  token: string;
  existingUsername: string | null;
  suggestedUsername: string;
}) {
  const [state, formAction, pending] = useActionState(claimInvite.bind(null, token), initialState);
  const isReset = existingUsername !== null;

  return (
    <form action={formAction} className="flex flex-col gap-3">
      {isReset ? (
        <p className="text-sm">
          Usuário: <strong>@{existingUsername}</strong>
        </p>
      ) : (
        <>
          <label className="text-sm font-medium" htmlFor="username">
            Nome de usuário
          </label>
          <input
            id="username"
            name="username"
            defaultValue={suggestedUsername}
            required
            autoFocus
            className={inputClass}
          />
          <p className="text-xs text-neutral-500">
            2 a 20 caracteres: letras minúsculas, números, ponto, hífen ou _
          </p>
        </>
      )}
      <label className="text-sm font-medium" htmlFor="password">
        {isReset ? "Nova senha" : "Senha"}
      </label>
      <input
        id="password"
        name="password"
        type="password"
        required
        minLength={6}
        autoFocus={isReset}
        className={inputClass}
      />
      <label className="text-sm font-medium" htmlFor="confirm">
        Confirmar senha
      </label>
      <input id="confirm" name="confirm" type="password" required minLength={6} className={inputClass} />
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-emerald-700 px-4 py-2 font-medium text-white hover:bg-emerald-800 disabled:opacity-60"
      >
        {pending ? "Salvando..." : isReset ? "Salvar nova senha" : "Criar conta"}
      </button>
    </form>
  );
}
