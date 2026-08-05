"use client";

import { useActionState } from "react";
import { changePassword, type ChangePasswordState } from "./actions";

const initialState: ChangePasswordState = {};

const inputClass =
  "rounded-lg border border-neutral-300 bg-white px-3 py-2 text-neutral-900 outline-none focus:border-emerald-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100";

export function ChangePasswordForm() {
  const [state, formAction, pending] = useActionState(changePassword, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <label className="text-sm font-medium" htmlFor="currentPassword">
        Senha atual
      </label>
      <input
        id="currentPassword"
        name="currentPassword"
        type="password"
        required
        className={inputClass}
      />
      <label className="text-sm font-medium" htmlFor="newPassword">
        Nova senha
      </label>
      <input
        id="newPassword"
        name="newPassword"
        type="password"
        required
        minLength={6}
        className={inputClass}
      />
      <label className="text-sm font-medium" htmlFor="confirm">
        Confirmar nova senha
      </label>
      <input id="confirm" name="confirm" type="password" required minLength={6} className={inputClass} />
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state.success && <p className="text-sm text-emerald-700">Senha alterada!</p>}
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-emerald-700 px-4 py-2 font-medium text-white hover:bg-emerald-800 disabled:opacity-60"
      >
        {pending ? "Salvando..." : "Salvar"}
      </button>
    </form>
  );
}
