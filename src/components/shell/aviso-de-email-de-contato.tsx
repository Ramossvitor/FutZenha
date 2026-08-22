"use client";

import { useActionState, useState } from "react";
import { gravarSnooze, snoozeVigente, useNoCliente } from "@/components/push/ambiente";
import { Banner } from "@/components/ui/banner";
import { Button, SubmitButton } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import type { EmailDeContatoState } from "@/app/perfil/actions";

const CHAVE_SNOOZE = "futzenha:email-contato:snooze";
// Bem menos que os 14 dias do convite de instalar: lá o que falta é uma
// preferência da pessoa, aqui é um dado que o app precisa ter para funcionar.
const DIAS_DE_SNOOZE = 7;

const initialState: EmailDeContatoState = {};

/**
 * Pede o e-mail de quem criou conta antes de o campo existir.
 *
 * Aparece no topo do conteúdo, em toda página, para quem não tem endereço
 * nenhum na conta (`session.temEmailDeContato`). Quem entrou pelo Google nunca
 * vê: aquele endereço já veio verificado.
 *
 * Não é um banner só de aviso — o campo está aqui dentro de propósito. Mandar a
 * pessoa até o perfil para depois voltar é onde este pedido morreria, e o dado
 * que falta é de uma linha.
 *
 * O snooze é por device (localStorage, ver ambiente.ts) e as leituras acontecem
 * no render guardadas pelo `useNoCliente` — mesmo mecanismo do CtaInstalarIos.
 * `aoSalvar` é a Server Action injetada pelo layout; ver o comentário do
 * `aoSair` na Sidebar para o porquê de não importá-la aqui.
 */
export function AvisoDeEmailDeContato({
  aoSalvar,
}: {
  aoSalvar: (prev: EmailDeContatoState, formData: FormData) => Promise<EmailDeContatoState>;
}) {
  const noCliente = useNoCliente();
  const [dispensadoAgora, setDispensadoAgora] = useState(false);
  const [state, formAction, pending] = useActionState(aoSalvar, initialState);

  // Some assim que salva: a sessão só reflete a coluna nova na próxima
  // navegação, e deixar o pedido na tela depois de atendido parece que não foi.
  if (!noCliente || dispensadoAgora || state.success) return null;
  if (snoozeVigente(CHAVE_SNOOZE, DIAS_DE_SNOOZE)) return null;

  return (
    <div className="mb-6 rounded-xl border border-line bg-surface-2 p-4">
      <p className="text-[13px] leading-[1.45] text-fg-2">
        <span className="font-display font-bold text-fg">Falta o seu e-mail.</span> É por ele que
        chegam os avisos do fut — quem entra continua sendo seu usuário e senha.
      </p>

      <form action={formAction} className="mt-3 flex flex-col gap-3">
        {/* O `id` é próprio, o `name` não: em /perfil este aviso e o
            EmailDeContatoForm aparecem juntos (a condição de um é a do outro),
            e dois `id="contactEmail"` no documento fariam o rótulo de lá focar
            o campo daqui. Quem lê o formulário é a action, que só olha `name`. */}
        <Field htmlFor="contactEmail-aviso" label="Seu e-mail" obrigatorio largura="medio">
          <Input
            id="contactEmail-aviso"
            name="contactEmail"
            type="email"
            required
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="email"
          />
        </Field>

        {state.error && <Banner tom="erro">{state.error}</Banner>}

        <div className="flex flex-wrap items-center gap-2">
          <SubmitButton pending={pending} labelPending="Salvando…">
            Salvar
          </SubmitButton>
          <Button
            variante="ghost"
            tamanho="sm"
            onClick={() => {
              gravarSnooze(CHAVE_SNOOZE);
              setDispensadoAgora(true);
            }}
          >
            Agora não
          </Button>
        </div>
      </form>
    </div>
  );
}
