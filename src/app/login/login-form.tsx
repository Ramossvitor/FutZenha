"use client";

import { useActionState } from "react";
import { Banner } from "@/components/ui/banner";
import { SubmitButton } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { login, type LoginState } from "./actions";

const initialState: LoginState = {};

export function LoginForm({ next }: { next?: string }) {
  const [state, formAction, pending] = useActionState(login, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {next && <input type="hidden" name="next" value={next} />}
      <Field htmlFor="username" label="Usuário" obrigatorio>
        <Input
          id="username"
          name="username"
          required
          autoFocus
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="username"
        />
      </Field>
      <Field htmlFor="password" label="Senha" obrigatorio>
        <Input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
        />
      </Field>
      {state.error && <Banner tom="erro">{state.error}</Banner>}
      <SubmitButton tamanho="lg" pending={pending} labelPending="Entrando…" className="w-full">
        Entrar
      </SubmitButton>
    </form>
  );
}
