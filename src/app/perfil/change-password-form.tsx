"use client";

import { useActionState } from "react";
import { Banner } from "@/components/ui/banner";
import { SubmitButton } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { MIN_SENHA } from "@/lib/regras";
import { changePassword, type ChangePasswordState } from "./actions";

const initialState: ChangePasswordState = {};

export function ChangePasswordForm() {
  const [state, formAction, pending] = useActionState(changePassword, initialState);

  return (
    <details className="border-t border-line pt-3 first:border-0 first:pt-0">
      <summary className="cursor-pointer font-display text-[14px] font-bold text-fg">
        Trocar senha
      </summary>
      <form action={formAction} className="mt-3 flex flex-col gap-4">
        <Field htmlFor="currentPassword" label="Senha atual" obrigatorio largura="medio">
          <Input
            id="currentPassword"
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            required
          />
        </Field>
        <Field
          htmlFor="newPassword"
          label="Nova senha"
          obrigatorio
          largura="medio"
          ajuda={`Pelo menos ${MIN_SENHA} caracteres.`}
        >
          <Input
            id="newPassword"
            name="newPassword"
            type="password"
            autoComplete="new-password"
            required
            minLength={MIN_SENHA}
          />
        </Field>
        <Field htmlFor="confirm" label="Confirmar nova senha" obrigatorio largura="medio">
          <Input
            id="confirm"
            name="confirm"
            type="password"
            autoComplete="new-password"
            required
            minLength={MIN_SENHA}
          />
        </Field>
        {state.error && <Banner tom="erro">{state.error}</Banner>}
        {state.success && <Banner tom="ok">Senha alterada.</Banner>}
        <SubmitButton pending={pending} labelPending="Salvando…" className="self-start">
          Salvar
        </SubmitButton>
      </form>
    </details>
  );
}
