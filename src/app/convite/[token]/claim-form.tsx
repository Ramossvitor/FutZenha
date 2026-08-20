"use client";

import { useActionState } from "react";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { SubmitButton } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { MIN_SENHA } from "@/lib/regras";
import { claimInvite, type ClaimState } from "./actions";

const initialState: ClaimState = {};

export function ClaimForm({
  token,
  existingUsername,
  suggestedUsername,
  precisaDeEmail,
}: {
  token: string;
  existingUsername: string | null;
  suggestedUsername: string;
  // Quem já tem endereço na conta não redigita. A action revalida por conta
  // própria — esconder o campo aqui é conveniência, não a regra.
  precisaDeEmail: boolean;
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

      {precisaDeEmail && (
        <Field
          htmlFor="contactEmail-claim"
          label="Seu e-mail"
          obrigatorio
          ajuda="Só para receber avisos do fut. Não serve para entrar — quem entra é usuário e senha."
        >
          <Input
            id="contactEmail-claim"
            name="contactEmail"
            type="email"
            required
            autoFocus={ehReset}
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="email"
          />
        </Field>
      )}

      <Field
        htmlFor="password"
        label={ehReset ? "Nova senha" : "Senha"}
        obrigatorio
        ajuda={`Pelo menos ${MIN_SENHA} caracteres.`}
      >
        <Input
          id="password"
          name="password"
          type="password"
          required
          minLength={MIN_SENHA}
          // O foco vai para o primeiro campo da vez: username no cadastro,
          // e-mail no reset de quem ainda precisa informá-lo, e só sobra para a
          // senha no reset de quem já tem endereço.
          autoFocus={ehReset && !precisaDeEmail}
          autoComplete="new-password"
        />
      </Field>

      <Field htmlFor="confirm" label="Confirmar senha" obrigatorio>
        <Input
          id="confirm"
          name="confirm"
          type="password"
          required
          minLength={MIN_SENHA}
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
