"use client";

import { useActionState } from "react";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { SubmitButton } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { claimInvite, type ClaimState } from "./actions";

const initialState: ClaimState = {};

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
  const ehReset = existingUsername !== null;

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {ehReset ? (
        <p className="flex items-center gap-2 text-[13px] text-fg-2">
          Usuário: <Badge tom="outline" caixa="normal">@{existingUsername}</Badge>
        </p>
      ) : (
        <Field
          htmlFor="username"
          label="Nome de usuário"
          obrigatorio
          ajuda="2 a 20 caracteres: letras minúsculas, números, ponto, hífen ou _"
        >
          <Input
            id="username"
            name="username"
            defaultValue={suggestedUsername}
            required
            autoFocus
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="username"
          />
        </Field>
      )}

      <Field htmlFor="password" label={ehReset ? "Nova senha" : "Senha"} obrigatorio>
        <Input
          id="password"
          name="password"
          type="password"
          required
          minLength={6}
          autoFocus={ehReset}
          autoComplete="new-password"
        />
      </Field>

      <Field htmlFor="confirm" label="Confirmar senha" obrigatorio>
        <Input
          id="confirm"
          name="confirm"
          type="password"
          required
          minLength={6}
          autoComplete="new-password"
        />
      </Field>

      {state.error && <Banner tom="erro">{state.error}</Banner>}

      <SubmitButton tamanho="lg" pending={pending} labelPending="Salvando…" className="w-full">
        {ehReset ? "Salvar nova senha" : "Criar conta"}
      </SubmitButton>
    </form>
  );
}
