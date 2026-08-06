"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { attendances, matchDays } from "@/db/schema";
import { requirePlayer } from "@/lib/require-player";

// Só o próprio jogador logado marca a própria presença; quem não tem conta é
// marcado pelo admin da pelada (definirPresenca, em ./gerenciar/actions.ts). O
// playerId vem sempre da sessão — nunca do cliente.
export async function setMyAttendance(matchDayId: number, status: "in" | "out") {
  const session = await requirePlayer();
  if (!session.player.active) return;

  const parsedId = z.number().int().positive().parse(matchDayId);
  const parsedStatus = z.enum(["in", "out"]).parse(status);

  const [matchDay] = await db.select().from(matchDays).where(eq(matchDays.id, parsedId));
  if (!matchDay) return;
  if (matchDay.status !== "scheduled") {
    // Status mudou entre o render e o clique — revalida para a UI travar os botões.
    revalidatePath(`/pelada/${parsedId}`);
    return;
  }

  await db
    .insert(attendances)
    .values({ matchDayId: parsedId, playerId: session.player.id, status: parsedStatus })
    .onConflictDoUpdate({
      target: [attendances.matchDayId, attendances.playerId],
      set: { status: parsedStatus, updatedAt: new Date() },
    });
  revalidatePath("/");
  revalidatePath(`/pelada/${parsedId}`);
  revalidatePath(`/pelada/${parsedId}/gerenciar`);
}
