"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { statusDaRecarga } from "../actions";

/**
 * O vigia da tela do pedido: enquanto o status é `pendente`, pergunta ao
 * servidor de tempos em tempos e recarrega a tela quando algo mudou.
 *
 * Sonda o SERVIDOR, não o gateway: a action `statusDaRecarga` é quem decide se
 * vale uma consulta lá fora (ver sondarPedido em src/lib/recarga.ts). Daqui só
 * sai a pergunta e o `router.refresh()` — a tela nova é renderizada no servidor
 * com o pedido já no estado final, e este componente sai da árvore junto.
 *
 * O `emVoo` impede a sobreposição: a sonda pode levar os 10s do timeout do
 * gateway, e um intervalo cego empilharia chamadas exatamente quando o MP está
 * lento. Perder um tique é barato; empilhar não é.
 */
const INTERVALO_MS = 5_000;

export function AcompanharRecarga({ pedidoId }: { pedidoId: number }) {
  const router = useRouter();
  const emVoo = useRef(false);

  useEffect(() => {
    const timer = setInterval(async () => {
      if (emVoo.current) return;
      emVoo.current = true;
      try {
        const status = await statusDaRecarga(pedidoId);
        if (status !== null && status !== "pendente") router.refresh();
      } catch {
        // Rede piscou no celular de quem está pagando — o próximo tique tenta
        // de novo, e a varredura do servidor confirma de qualquer jeito.
      } finally {
        emVoo.current = false;
      }
    }, INTERVALO_MS);
    return () => clearInterval(timer);
  }, [pedidoId, router]);

  return null;
}
