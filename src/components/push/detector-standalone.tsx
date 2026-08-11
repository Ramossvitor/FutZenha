"use client";

import { useEffect } from "react";
import { emStandalone } from "./ambiente";

/**
 * Prova de instalação: uma sessão logada rodando em standalone só existe se a
 * pessoa instalou o app e entrou nele.
 *
 * É a única detecção confiável no iOS — lá não existe `appinstalled` nem
 * `beforeinstallprompt`, e o app instalado tem cookies/localStorage SEPARADOS
 * do Safari, então nenhuma marca gravada no browser sobrevive à instalação. A
 * flag vai para a conta (users.pwa_instalado_em) via action, e é ela que faz o
 * convite de instalar sumir em qualquer browser do usuário.
 *
 * `jaMarcado` evita repetir o UPDATE a cada navegação de quem já provou.
 *
 * `aoDetectar` é a Server Action injetada pelo layout — pelo mesmo motivo do
 * `aoSair` da Sidebar: importar `@/app/pwa/actions` daqui abriria uma aresta de
 * `src/components/` para dentro de `src/app/`.
 */
export function DetectorStandalone({
  jaMarcado,
  aoDetectar,
}: {
  jaMarcado: boolean;
  aoDetectar: () => Promise<void>;
}) {
  useEffect(() => {
    if (jaMarcado || !emStandalone()) return;
    aoDetectar().catch(() => {
      /* melhor perder a marca do que quebrar a navegação */
    });
  }, [jaMarcado, aoDetectar]);
  return null;
}
