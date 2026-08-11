import "server-only";
import { cache } from "react";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, type Executor } from "@/db";
import { notifications, type Notification, type NotificationType } from "@/db/schema";

export type NovaNotificacao = {
  playerId: number;
  type: NotificationType;
  title: string;
  body?: string;
  href?: string;
  /**
   * Chave estável do evento que gerou a notificação — `rodada:12:aberta`,
   * `nota:rodada:12`, `nota:denuncia:7`. É o que torna notificar() idempotente:
   * reprocessar a mesma rodada não enche a caixa de entrada de duplicatas.
   */
  dedupeKey: string;
};

export async function notificar(exec: Executor, novas: NovaNotificacao[]): Promise<void> {
  if (novas.length === 0) return;
  await exec
    .insert(notifications)
    .values(novas)
    .onConflictDoNothing({ target: [notifications.playerId, notifications.dedupeKey] });
}

/** Uma linha reivindicada pelo despacho de push — ver reivindicarPendentesDePush. */
export type AvisoPendenteDePush = {
  id: number;
  playerId: number;
  title: string;
  body: string | null;
  href: string | null;
  createdAt: Date;
};

/**
 * Marca um lote de avisos como despachados e devolve as linhas — o claim do
 * outbox de push (src/lib/push-envio.ts), num comando só.
 *
 * Mora aqui, e não lá, porque `push_dispatched_at` é coluna de `notifications`:
 * quem escreve nesta tabela é este módulo, como em notificar(). O lock que
 * segura a corrida entre instâncias é do despachante — ele passa o `exec` da
 * transação já travada.
 */
export async function reivindicarPendentesDePush(
  exec: Executor,
  limite: number,
): Promise<AvisoPendenteDePush[]> {
  // Subconsulta (builder, não executada aqui) com order+limit: é o que dá um
  // lote determinístico e do tamanho pedido, igual ao `condicaoElegivel`.
  const lote = db
    .select({ id: notifications.id })
    .from(notifications)
    .where(isNull(notifications.pushDispatchedAt))
    .orderBy(asc(notifications.id))
    .limit(limite);

  return exec
    .update(notifications)
    .set({ pushDispatchedAt: sql`now()` })
    .where(inArray(notifications.id, lote))
    .returning({
      id: notifications.id,
      playerId: notifications.playerId,
      title: notifications.title,
      body: notifications.body,
      href: notifications.href,
      createdAt: notifications.createdAt,
    });
}

// `cache()` porque o layout e /perfil contam no mesmo render.
export const contarNaoLidas = cache(async (playerId: number): Promise<number> => {
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.playerId, playerId), isNull(notifications.readAt)));
  return row?.total ?? 0;
});

export async function listarNotificacoes(playerId: number, limite = 50): Promise<Notification[]> {
  return db
    .select()
    .from(notifications)
    .where(eq(notifications.playerId, playerId))
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(limite);
}
