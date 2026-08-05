"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { players } from "@/db/schema";
import { requireAdmin } from "@/lib/require-admin";

const playerSchema = z.object({
  name: z.string().trim().min(1, "Nome é obrigatório").max(60),
  nickname: z
    .string()
    .trim()
    .max(60)
    .transform((v) => (v === "" ? null : v)),
  skill: z.coerce.number().int().min(1).max(10),
  isGoalkeeper: z.coerce.boolean(),
});

function parsePlayerForm(formData: FormData) {
  return playerSchema.safeParse({
    name: formData.get("name") ?? "",
    nickname: formData.get("nickname") ?? "",
    skill: formData.get("skill") ?? 5,
    isGoalkeeper: formData.get("isGoalkeeper") === "on",
  });
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

export async function createPlayer(formData: FormData) {
  await requireAdmin();
  const parsed = parsePlayerForm(formData);
  if (!parsed.success) redirect("/admin/jogadores?erro=dados-invalidos");

  try {
    await db.insert(players).values(parsed.data);
  } catch (error) {
    if (isUniqueViolation(error)) redirect("/admin/jogadores?erro=nome-duplicado");
    throw error;
  }
  revalidatePath("/admin/jogadores");
  redirect("/admin/jogadores");
}

export async function updatePlayer(playerId: number, formData: FormData) {
  await requireAdmin();
  const parsed = parsePlayerForm(formData);
  if (!parsed.success) redirect("/admin/jogadores?erro=dados-invalidos");

  try {
    await db.update(players).set(parsed.data).where(eq(players.id, playerId));
  } catch (error) {
    if (isUniqueViolation(error)) redirect("/admin/jogadores?erro=nome-duplicado");
    throw error;
  }
  revalidatePath("/admin/jogadores");
  redirect("/admin/jogadores");
}

export async function setPlayerActive(playerId: number, active: boolean) {
  await requireAdmin();
  await db.update(players).set({ active }).where(eq(players.id, playerId));
  revalidatePath("/admin/jogadores");
}
