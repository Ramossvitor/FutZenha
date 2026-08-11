"use client";

import { useEffect } from "react";

/**
 * Registra o service worker em toda visita. Incondicional de propósito: o
 * registro é barato, idempotente, e precisa existir ANTES de qualquer pedido de
 * assinatura de push — inclusive no primeiro abrir do app recém-instalado.
 *
 * `updateViaCache: "none"` casa com o no-cache do next.config.ts: o browser
 * revalida o sw.js a cada registro em vez de segurar a versão velha por 24h.
 */
export function RegistrarSw() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .catch(() => {
        /* http sem ser localhost, storage bloqueado — sem SW, sem push, e o
           resto do app segue normal */
      });
  }, []);
  return null;
}
