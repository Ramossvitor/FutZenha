"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { attendances, matchDays } from "@/db/schema";

// Ação pública de propósito: o site é de um grupo fechado de amigos e a
// confirmação de presença funciona na base da confiança, sem login.
export async function setAttendancePublic(
  matchDayId: number,
  playerId: number,
  status: "in" | "out",
) {
  const [matchDay] = await db.select().from(matchDays).where(eq(matchDays.id, matchDayId));
  if (!matchDay || matchDay.status !== "scheduled") return;

  await db
    .insert(attendances)
    .values({ matchDayId, playerId, status })
    .onConflictDoUpdate({
      target: [attendances.matchDayId, attendances.playerId],
      set: { status, updatedAt: new Date() },
    });
  revalidatePath("/");
  revalidatePath(`/pelada/${matchDayId}`);
  revalidatePath(`/admin/peladas/${matchDayId}`);
}
