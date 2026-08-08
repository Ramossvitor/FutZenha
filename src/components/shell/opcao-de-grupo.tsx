"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { IconeCheck } from "@/components/ui/icons";
import { cx } from "@/lib/cx";
import { LINHA_DO_SELETOR, PAINEL_DE_GRUPO_ID } from "./seletor-de-grupo";

/**
 * Uma linha do seletor de grupo. Irmã do SubmitDeCartao — mesmo pulso, mesma
 * trava de reenvio —, com um trabalho a mais: fechar o painel quando a action
 * termina.
 *
 * O popover nativo cuida de Escape e de clique fora sozinho. O que ele não tem
 * como saber é que uma Server Action acabou de voltar: `pending` caindo de true
 * para false é o único sinal, e sem ele o painel ficaria aberto por cima do app
 * já com o grupo trocado — o chip vive no layout, que não remonta em navegação
 * nenhuma.
 *
 * As duas formas da linha (a que troca e a que só fecha) moram neste mesmo
 * componente, e isso NÃO é economia de arquivo: a linha clicada vira a linha
 * ativa no commit em que a action volta. Separar em dois componentes
 * desmontaria esta instância exatamente aí, e o efeito acima nunca chegaria a
 * ver `pending` em false — o painel ficaria aberto para sempre.
 */
export function OpcaoDeGrupo({ ativo, children }: { ativo: boolean; children: ReactNode }) {
  const { pending } = useFormStatus();
  const emVoo = useRef(false);

  useEffect(() => {
    if (pending) {
      emVoo.current = true;
      return;
    }
    if (!emVoo.current) return;
    emVoo.current = false;

    const painel = document.getElementById(PAINEL_DE_GRUPO_ID);
    // `hidePopover()` em popover já fechado lança InvalidStateError — quem
    // apertou Escape no meio da troca cairia nesse caso.
    if (painel?.matches(":popover-open")) painel.hidePopover();
  }, [pending]);

  const conteudo = (
    <>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {ativo && <IconeCheck className="size-4 shrink-0 text-accent-ink" />}
    </>
  );

  // Trocar para o contexto em que já estamos seria um POST com consulta de papel
  // e re-render de layout inteiro para não mudar nada. Tocar na linha atual é o
  // "deixa pra lá", então ela só fecha o painel — pelo próprio popover, sem
  // passar pelo servidor nem pelo efeito acima.
  if (ativo) {
    return (
      <button
        type="button"
        popoverTarget={PAINEL_DE_GRUPO_ID}
        popoverTargetAction="hide"
        aria-current="true"
        className={cx(LINHA_DO_SELETOR, "font-display text-[14px] font-bold text-fg")}
      >
        {conteudo}
      </button>
    );
  }

  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending || undefined}
      className={cx(
        LINHA_DO_SELETOR,
        "text-[14px] text-fg-2 hover:text-fg",
        pending && "animate-pulse opacity-60",
      )}
    >
      {conteudo}
    </button>
  );
}
