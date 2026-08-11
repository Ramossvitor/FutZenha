"use client";

import { useActionState } from "react";
import { Banner } from "@/components/ui/banner";
import { SubmitButton } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { salvarEmailDeContato, type EmailDeContatoState } from "./actions";

const initialState: EmailDeContatoState = {};

/**
 * O e-mail de contato no perfil.
 *
 * O aviso no layout captura o endereço de quem ainda não tem; este é o único
 * lugar em que dá para CORRIGIR um que saiu errado — e é o que a pessoa procura
 * quando troca de e-mail.
 */
export function EmailDeContatoForm({ atual }: { atual: string | null }) {
  const [state, formAction, pending] = useActionState(salvarEmailDeContato, initialState);

  return (
    <details className="border-t border-line pt-3 first:border-0 first:pt-0">
      <summary className="cursor-pointer font-display text-[14px] font-bold text-fg">
        {atual ? "Trocar e-mail de contato" : "Informar e-mail de contato"}
      </summary>
      <form action={formAction} className="mt-3 flex flex-col gap-4">
        <Field
          htmlFor="contactEmail"
          label="Seu e-mail"
          obrigatorio
          ajuda="Só para receber avisos do fut — não é por ele que você entra."
        >
          <Input
            id="contactEmail"
            name="contactEmail"
            type="email"
            required
            defaultValue={atual ?? ""}
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="email"
          />
        </Field>
        {state.error && <Banner tom="erro">{state.error}</Banner>}
        {state.success && <Banner tom="ok">E-mail salvo.</Banner>}
        <SubmitButton pending={pending} labelPending="Salvando…" className="self-start">
          Salvar
        </SubmitButton>
      </form>
    </details>
  );
}
