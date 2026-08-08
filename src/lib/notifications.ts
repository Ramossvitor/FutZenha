import "server-only";
import { cache } from "react";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
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
