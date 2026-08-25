"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * As Server Actions de push, injetadas por quem usa o hook.
 *
 * Vêm por parâmetro e não por import porque `@/app/(esqueleto)/pwa/actions` é `"use server"`:
 * importá-lo daqui abriria uma aresta de `src/components/` para dentro de
 * `src/app/` — a mesma que o comentário do `aoSair` em
 * src/components/shell/sidebar.tsx documenta como a única do projeto, e que
 * este módulo teria sido a segunda.
 */
export type AcoesDePush = {
  aoAssinar: (sub: unknown) => Promise<{ ok: boolean }>;
  aoCancelar: (endpoint: string) => Promise<void>;
};

// Formato que o pushManager.subscribe exige para a chave VAPID (base64url →
// bytes). Do guia oficial do Next (guides/progressive-web-apps). Exportado para
// o teste unit: padding errado ou uma troca de `-`/`_` esquecida quebra o
// subscribe de TODO device, e o catch do ativar() transforma isso no mesmo
// banner genérico de falha de rede — indistinguível em produção.
export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  // O ArrayBuffer explícito é o que faz o TS aceitar no applicationServerKey —
  // Uint8Array "cru" é tipado sobre ArrayBufferLike, que inclui SharedArrayBuffer.
  const outputArray = new Uint8Array(new ArrayBuffer(rawData.length));
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// Sem NEXT_PUBLIC_VAPID_PUBLIC_KEY no build, nenhuma UI de push aparece — o
// kill switch do cliente, mesmo contrato do emailConfigurado() no servidor. O
// iOS no Safari (fora do app instalado) cai aqui também: o PushManager nem
// existe lá. Exportado porque o E2E só consegue provar o lado negativo (a UI
// some sem a chave); o lado positivo mora no teste unit.
export function suporteDoBrowser(): boolean {
  return (
    Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

type EstadoDePush = {
  suportado: boolean;
  permissao: NotificationPermission | null;
  inscritoNesteDevice: boolean;
};

/**
 * Estado e controles de push DESTE device, compartilhados pelo pré-prompt e
 * pelo painel do perfil.
 *
 * O estado nasce "sem suporte" e só muda quando o service worker fica pronto —
 * a atualização acontece no .then, nunca no corpo do efeito (regra
 * set-state-in-effect). Se o registro do SW falhou, `ready` não resolve e a UI
 * de push simplesmente não aparece — sem SW não haveria push mesmo.
 *
 * `ativar()` roda inteiro dentro do gesto do clique — exigência do iOS para o
 * requestPermission — e desfaz a assinatura no browser se o servidor recusar:
 * assinatura órfã receberia push de um jogador que não é mais o da sessão.
 */
export function usePush({ aoAssinar, aoCancelar }: AcoesDePush): EstadoDePush & {
  ativar: () => Promise<"ok" | "negado" | "erro">;
  desativar: () => Promise<void>;
} {
  const [estado, setEstado] = useState<EstadoDePush>({
    suportado: false,
    permissao: null,
    inscritoNesteDevice: false,
  });

  useEffect(() => {
    if (!suporteDoBrowser()) return;
    let cancelado = false;
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then(async (sub) => {
        if (cancelado) return;
        setEstado({
          suportado: true,
          permissao: Notification.permission,
          inscritoNesteDevice: sub !== null,
        });
        // Reconciliação de dono, e é o que fecha o vazamento entre contas: a
        // assinatura do browser é do APARELHO, não da conta — ela sobrevive ao
        // logout. Sem este re-assinar, num celular compartilhado o
        // getSubscription() de quem entrar depois volta não-nulo, a UI diz
        // "este aparelho recebe os avisos" e a linha no banco continua
        // apontando para o dono anterior, que segue recebendo os próprios
        // avisos na tela de bloqueio de outra pessoa. O upsert é idempotente,
        // então convergir no mount custa uma escrita indexada por visita.
        if (sub) await aoAssinar(JSON.parse(JSON.stringify(sub)));
      })
      .catch(() => {});
    return () => {
      cancelado = true;
    };
  }, [aoAssinar]);

  const ativar = useCallback(async (): Promise<"ok" | "negado" | "erro"> => {
    try {
      const resposta = await Notification.requestPermission();
      setEstado((e) => ({ ...e, permissao: resposta }));
      if (resposta !== "granted") return "negado";

      const reg = await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!),
        }));

      // PushSubscription não é objeto plano — o toJSON dá a forma serializável.
      const { ok } = await aoAssinar(JSON.parse(JSON.stringify(sub)));
      if (!ok) {
        await sub.unsubscribe().catch(() => {});
        return "erro";
      }
      setEstado((e) => ({ ...e, inscritoNesteDevice: true }));
      return "ok";
    } catch {
      return "erro";
    }
  }, [aoAssinar]);

  const desativar = useCallback(async (): Promise<void> => {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (!sub) return;
      // Servidor primeiro: se o unsubscribe local falhar sobra um endpoint que
      // o próximo despacho limpa via 404/410 — o contrário deixaria o banco
      // mandando push para um device que pediu silêncio.
      await aoCancelar(sub.endpoint);
      await sub.unsubscribe().catch(() => {});
      setEstado((e) => ({ ...e, inscritoNesteDevice: false }));
    } catch {
      /* sem SW não há o que desativar */
    }
  }, [aoCancelar]);

  return { ...estado, ativar, desativar };
}
