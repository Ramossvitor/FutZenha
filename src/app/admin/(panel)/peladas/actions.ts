"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { attendances, matchDays } from "@/db/schema";
import { requireAdmin } from "@/lib/require-admin";

const matchDaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida"),
  startTime: z
    .string()
    .transform((v) => (v === "" ? null : v)),
  location: z.string().trim().min(1, "Local é obrigatório").max(120),
  notes: z
    .string()
    .trim()
    .max(500)
    .transform((v) => (v === "" ? null : v)),
});

function parseMatchDayForm(formData: FormData) {
  return matchDaySchema.safeParse({
    date: formData.get("date") ?? "",
    startTime: formData.get("startTime") ?? "",
    location: formData.get("location") ?? "",
    notes: formData.get("notes") ?? "",
  });
}

export async function createMatchDay(formData: FormData) {
  await requireAdmin();
  const parsed = parseMatchDayForm(formData);
  if (!parsed.success) redirect("/admin/peladas?erro=dados-invalidos");

  const [created] = await db.insert(matchDays).values(parsed.data).returning();
  revalidatePath("/");
  revalidatePath("/admin/peladas");
  redirect(`/admin/peladas/${created.id}`);
}

export async function updateMatchDay(matchDayId: number, formData: FormData) {
  await requireAdmin();
  const parsed = parseMatchDayForm(formData);
  if (!parsed.success) redirect(`/admin/peladas/${matchDayId}?erro=dados-invalidos`);

  await db.update(matchDays).set(parsed.data).where(eq(matchDays.id, matchDayId));
  revalidatePath("/");
  revalidatePath(`/admin/peladas/${matchDayId}`);
  revalidatePath(`/pelada/${matchDayId}`);
}

export async function deleteMatchDay(matchDayId: number) {
  await requireAdmin();
  await db.delete(matchDays).where(eq(matchDays.id, matchDayId));
  revalidatePath("/");
  revalidatePath("/admin/peladas");
  redirect("/admin/peladas");
}

export async function setAttendanceAdmin(
  matchDayId: number,
  playerId: number,
  status: "in" | "out",
) {
  await requireAdmin();
  await db
    .insert(attendances)
    .values({ matchDayId, playerId, status })
    .onConflictDoUpdate({
      target: [attendances.matchDayId, attendances.playerId],
      set: { status, updatedAt: new Date() },
    });
  revalidatePath("/");
  revalidatePath(`/admin/peladas/${matchDayId}`);
  revalidatePath(`/pelada/${matchDayId}`);
}
