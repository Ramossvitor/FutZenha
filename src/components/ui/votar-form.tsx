"use client";

import { useActionState } from "react";
import { Banner } from "./banner";
import { SubmitButton } from "./button";

export type VotarState = { error?: string; success?: boolean };

const initialState: VotarState = {};

/**
 * Os dois votos, em formulários que competem.
 *
 * São dois `useActionState` porque cada botão manda um valor diferente para a
 * mesma action, e o `pending` de um precisa desabilitar o outro — votar é
 * definitivo, e um duplo clique atrapalhado não pode registrar o contrário do
 * que a pessoa quis.
 *
 * A action entra por prop porque este form serve duas rotas — /votacao/[id] e a
 * home — e importá-la de dentro de uma delas faria a outra alcançar um arquivo
 * colocado numa rota que não é a sua.
 */
export function VotarForm({
  voteId,
  acaoVotar,
}: {
  voteId: number;
  acaoVotar: (voteId: number, aFavor: boolean) => Promise<VotarState>;
}) {
  const [state, formAction, pending] = useActionState(
    acaoVotar.bind(null, voteId, true),
    initialState,
  );
  const [stateNao, formActionNao, pendingNao] = useActionState(
    acaoVotar.bind(null, voteId, false),
    initialState,
  );
  const erro = state.error ?? stateNao.error;
  const ocupado = pending || pendingNao;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <form action={formActionNao} className="flex-1">
          <SubmitButton
            variante="secondary"
            disabled={ocupado}
            pending={pendingNao}
            labelPending="Registrando…"
            className="w-full"
          >
            Manter
          </SubmitButton>
        </form>
        <form action={formAction} className="flex-1">
          <SubmitButton
            variante="danger"
            disabled={ocupado}
            pending={pending}
            labelPending="Registrando…"
            className="w-full"
          >
            Sim, apagar
          </SubmitButton>
        </form>
      </div>
      {erro && <Banner tom="erro">{erro}</Banner>}
    </div>
  );
}
