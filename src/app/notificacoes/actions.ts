"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { notifications } from "@/db/schema";
import { requirePlayer } from "@/lib/require-player";

// O playerId vem sempre da sessão — nunca do cliente. Sem isso, marcar como
// lida viraria um jeito de mexer na caixa de entrada dos outros.
export async function marcarComoLida(notificationId: number) {
  const session = await requirePlayer();
  const id = z.number().int().positive().parse(notificationId);

  await db
    .update(notifications)
    .set({ readAt: sql`now()` })
    .where(
      and(
        eq(notifications.id, id),
        eq(notifications.playerId, session.player.id),
        isNull(notifications.readAt),
      ),
    );
  revalidatePath("/notificacoes");
}

export async function marcarTodasComoLidas() {
  const session = await requirePlayer();
  await db
    .update(notifications)
    .set({ readAt: sql`now()` })
    .where(and(eq(notifications.playerId, session.player.id), isNull(notifications.readAt)));
  revalidatePath("/notificacoes");
}
