"use server";

import { headers } from "next/headers";
import { and, desc, eq, isNull, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { pushSubscriptions, users } from "@/db/schema";
import { getSession } from "@/lib/session";

// Actions de PWA são fire-and-forget disparadas de useEffect/clique — por isso
// getSession com no-op em vez de requirePlayer: um redirect de action arrastaria
// a pessoa para /login no meio da navegação por causa de uma sessão expirada.

/**
 * Chamada quando uma sessão logada roda em display-mode standalone — a prova de
 * que a pessoa instalou o app. O iOS não tem evento de instalação e o app
 * instalado nem compartilha storage com o Safari; é este login dentro do app
 * que grava a flag, e é a flag que esconde o convite de instalar em todo lugar.
 */
export async function marcarPwaInstalado(): Promise<void> {
  const session = await getSession();
  if (!session) return;
  // O IS NULL preserva a data da primeira vez — abrir o app de novo não é
  // reinstalar.
  await db
    .update(users)
    .set({ pwaInstaladoEm: sql`now()` })
    .where(and(eq(users.id, session.userId), isNull(users.pwaInstaladoEm)));
}

/** A pessoa abriu as instruções de instalar. Clicar ≠ instalar. */
export async function marcarCtaPwaClicado(): Promise<void> {
  const session = await getSession();
  if (!session) return;
  await db
    .update(users)
    .set({ pwaCtaClicadoEm: sql`now()` })
    .where(eq(users.id, session.userId));
}

// Os únicos hosts que emitem endpoint de Web Push. A lista existe porque uma
// Server Action é endpoint HTTP público: sem ela, qualquer jogador logado
// gravava um endpoint apontando para onde quisesse e o despacho fazia o
// SERVIDOR abrir um POST https para lá — com o JWT VAPID assinado junto. É um
// primitivo de requisição server-side (SSRF) de graça. Sufixo e não igualdade
// porque os push services usam subdomínios por região/instância.
const HOSTS_DE_PUSH = [
  "googleapis.com", // Chrome/Android — fcm.googleapis.com
  "push.services.mozilla.com", // Firefox
  "push.apple.com", // Safari/iOS — web.push.apple.com
  "notify.windows.com", // Edge legado
  "push.microsoft.com", // Edge atual
];

function hostDePushConhecido(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return HOSTS_DE_PUSH.some((host) => hostname === host || hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

// Teto de devices por jogador. Cada assinatura multiplica o fan-out do despacho
// (uma requisição HTTPS por aviso × assinatura), então uma conta que cadastrasse
// endpoints em massa transformava uma varredura em milhares de conexões — e como
// o claim marca o lote antes de enviar, derrubar a varredura suprimia o push de
// todo mundo naquele lote. Vinte cobre qualquer uso real.
const MAX_ASSINATURAS_POR_JOGADOR = 20;

// A forma serializada de um PushSubscription do browser. O tamanho é teto de
// sanidade: endpoints reais têm ~200 chars e as chaves ~90 — o limite só barra
// abuso de quem chamar a action na mão.
const subscriptionSchema = z.object({
  endpoint: z
    .url()
    .max(2048)
    .startsWith("https://")
    .refine(hostDePushConhecido, "endpoint fora dos push services conhecidos"),
  keys: z.object({
    p256dh: z.string().min(1).max(512),
    auth: z.string().min(1).max(512),
  }),
});

/**
 * Grava a assinatura de push deste device. Upsert pelo endpoint: o mesmo
 * aparelho re-assinando — ou logado com outra conta — atualiza a linha em vez
 * de acumular; um device entrega para um jogador por vez.
 */
export async function assinarPush(sub: unknown): Promise<{ ok: boolean }> {
  const session = await getSession();
  if (!session) return { ok: false };
  const parsed = subscriptionSchema.safeParse(sub);
  if (!parsed.success) return { ok: false };

  const userAgent = (await headers()).get("user-agent")?.slice(0, 512) ?? null;
  await db
    .insert(pushSubscriptions)
    .values({
      playerId: session.player.id,
      endpoint: parsed.data.endpoint,
      p256dh: parsed.data.keys.p256dh,
      auth: parsed.data.keys.auth,
      userAgent,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: {
        playerId: session.player.id,
        p256dh: parsed.data.keys.p256dh,
        auth: parsed.data.keys.auth,
        userAgent,
      },
    });

  // Mantém só os MAX_ASSINATURAS_POR_JOGADOR mais recentes deste jogador.
  const manter = db
    .select({ id: pushSubscriptions.id })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.playerId, session.player.id))
    .orderBy(desc(pushSubscriptions.createdAt), desc(pushSubscriptions.id))
    .limit(MAX_ASSINATURAS_POR_JOGADOR);
  await db
    .delete(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.playerId, session.player.id),
        notInArray(pushSubscriptions.id, manter),
      ),
    );

  return { ok: true };
}

/**
 * Remove a assinatura deste device. O filtro por playerId é o que impede
 * apagar assinatura alheia chutando endpoints — cancelar é só do dono.
 */
export async function cancelarPush(endpoint: string): Promise<void> {
  const session = await getSession();
  if (!session) return;
  if (typeof endpoint !== "string" || endpoint.length > 2048) return;
  await db
    .delete(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.endpoint, endpoint),
        eq(pushSubscriptions.playerId, session.player.id),
      ),
    );
}
