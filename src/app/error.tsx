"use client";

import { useEffect } from "react";
import { Button, LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * O que aparece quando um render dinâmico falha — antes disto era a tela crua
 * "Application error" do Next.
 *
 * O aviso de conferir antes de repetir não é floreio: o caso clássico aqui é a
 * action gravar, o redirect levar para uma página cuja query falha, e a pessoa
 * repetir a operação achando que nada foi salvo — foi assim que nasceu grupo
 * duplicado em produção. O shell (abas, lateral) continua de pé porque este
 * boundary fica abaixo do layout raiz.
 */
export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  /**
   * `retry`, não `reset`: reset() só limpa o boundary e re-renderiza o MESMO
   * payload com erro — para falha transitória de servidor (o caso todo desta
   * tela) o botão seria um no-op. retry() refaz o fetch antes de limpar.
   */
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-col gap-6 py-6">
      <EmptyState
        titulo="Algo falhou por aqui"
        descricao={
          <>
            Pode ter sido uma instabilidade momentânea. Se você acabou de criar ou salvar algo,
            confira se já não está lá antes de repetir — a ação pode ter sido concluída mesmo com
            este erro.
            {error.digest && (
              <span className="mt-1.5 block text-[11px] text-fg-dim" data-num>
                código {error.digest}
              </span>
            )}
          </>
        }
        acao={
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button onClick={retry}>Tentar de novo</Button>
            <LinkButton href="/" variante="secondary">
              Ir para o início
            </LinkButton>
          </div>
        }
      />
    </div>
  );
}
