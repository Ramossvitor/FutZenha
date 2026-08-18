"use client";

import { useActionState } from "react";
import { Banner } from "@/components/ui/banner";
import { SubmitButton } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { denunciarAvaliacao, type DenunciarState } from "./actions";

const initialState: DenunciarState = {};

export function DenunciarForm({ roundId, indice }: { roundId: number; indice: number }) {
  const [state, formAction, pending] = useActionState(
    denunciarAvaliacao.bind(null, roundId, indice),
    initialState,
  );

  if (state.success) {
    return (
      <p className="text-[12px] font-semibold text-accent-ink">
        Denúncia enviada. Quem administra a plataforma tem 48 horas para responder.
      </p>
    );
  }

  return (
    <details className="w-full">
      <summary className="cursor-pointer text-[12px] font-semibold text-fg-3 hover:text-danger-ink">
        Achei injusta
      </summary>
      <form action={formAction} className="mt-2 flex flex-col gap-2">
        <Textarea
          name="reason"
          rows={2}
          maxLength={500}
          placeholder="Por que você acha que esta nota foi injusta? (opcional)"
          aria-label="Motivo da denúncia"
        />
        {state.error && <Banner tom="erro">{state.error}</Banner>}
        <SubmitButton
          variante="danger-outline"
          tamanho="sm"
          pending={pending}
          labelPending="Enviando…"
          className="self-start"
        >
          Reportar
        </SubmitButton>
      </form>
    </details>
  );
}
