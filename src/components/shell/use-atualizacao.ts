"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";

// O ÚNICO useRouter do projeto, e de propósito.
//
// O padrão da casa é <form action={serverAction}> + SubmitButton, que dá pending
// e desabilitação de graça. Aqui não serve: um dos dois disparos é um gesto de
// toque, e gesto não tem submit. E o `refresh()` do next/cache — o caminho
// server-side — só roda dentro de Server Action nesta versão (ver
// next/dist/docs/01-app/03-api-reference/04-functions/refresh.md), então sobra a
// API de cliente.
//
// Não há `revalidatePath` junto porque não há o que invalidar: o app não tem
// cache de dados no servidor (nenhum `use cache`, nenhum unstable_cache, nenhum
// ISR) — toda página já é dinâmica por request. `router.refresh()` refaz o
// payload RSC da rota atual, layout incluído (então o contador do sino também
// vem novo), preservando scroll, estado de cliente e a query string.

/**
 * A espera depois de concluir.
 *
 * Não é enfeite de UI, é a trava de carga: um refresh de /rankings são ~7
 * round-trips ao Postgres (5 deles do pedágio fixo do root layout) e /perfil são
 * ~13, contra uma pool de `max: 5` por instância e zero rate limiting no
 * servidor — decisão registrada em src/app/(esqueleto)/login/actions.ts. Cinco segundos
 * limitam a 12 atualizações por minuto por pessoa, o que fica abaixo do que a
 * mesma pessoa já gera navegando entre as abas.
 */
const ESPERA_MS = 5000;

type EstadoDaAtualizacao = "parado" | "atualizando" | "concluido";

/**
 * Os rótulos moram aqui porque os dois disparos — o gesto do celular e o botão
 * do desktop — precisam dizer a mesma coisa, e porque em ambos eles são o que
 * carrega o estado quando o spinner não pode girar (ver o comentário do
 * puxar-para-atualizar.tsx sobre movimento reduzido).
 */
export const ROTULO: Record<EstadoDaAtualizacao, string> = {
  parado: "Atualizar",
  atualizando: "Atualizando…",
  concluido: "Atualizado",
};

export function useAtualizacao(): {
  atualizar: () => void;
  estado: EstadoDaAtualizacao;
} {
  const router = useRouter();
  const [emVoo, iniciarTransicao] = useTransition();
  const [concluido, setConcluido] = useState(false);

  // O pending da transição só cai quando o RSC novo é APLICADO, não quando a
  // resposta chega — é o que faz dele um indicador honesto, e é o que garante
  // que nunca haja duas atualizações em voo pela mesma pessoa.
  const estavaEmVoo = useRef(false);
  useEffect(() => {
    if (emVoo) {
      estavaEmVoo.current = true;
      return;
    }
    // Sem isto, a montagem do componente já cairia direto em "concluido".
    if (!estavaEmVoo.current) return;
    estavaEmVoo.current = false;

    setConcluido(true);
    const relogio = setTimeout(() => setConcluido(false), ESPERA_MS);
    return () => clearTimeout(relogio);
  }, [emVoo]);

  const atualizar = useCallback(() => {
    if (emVoo || concluido) return;
    iniciarTransicao(() => {
      router.refresh();
    });
  }, [emVoo, concluido, router]);

  return {
    atualizar,
    estado: emVoo ? "atualizando" : concluido ? "concluido" : "parado",
  };
}
