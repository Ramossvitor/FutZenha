"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { invites, players, users } from "@/db/schema";
import { isUniqueViolation } from "@/lib/db-errors";
import { requireAdmin } from "@/lib/require-admin";

const playerSchema = z.object({
  name: z.string().trim().min(1, "Nome é obrigatório").max(60),
  nickname: z
    .string()
    .trim()
    .max(60)
    .transform((v) => (v === "" ? null : v)),
  isGoalkeeper: z.coerce.boolean(),
});

function parsePlayerForm(formData: FormData) {
  return playerSchema.safeParse({
    name: formData.get("name") ?? "",
    nickname: formData.get("nickname") ?? "",
    isGoalkeeper: formData.get("isGoalkeeper") === "on",
  });
}

const INVITE_DURATION_MS = 1000 * 60 * 60 * 24 * 7; // 7 dias

// Cadastrar já cria o convite: participar da pelada é coisa de quem está no
// sistema, então ninguém nasce sem acesso a caminho. O link continua sendo
// entregue na mão pelo admin (não há e-mail), e o botão de gerar convite segue
// existindo para reenviar quando o prazo vencer.
export async function createPlayer(formData: FormData) {
  await requireAdmin();
  const parsed = parsePlayerForm(formData);
  if (!parsed.success) redirect("/admin/jogadores?erro=dados-invalidos");

  try {
    await db.transaction(async (tx) => {
      const [created] = await tx.insert(players).values(parsed.data).returning();
      await tx.insert(invites).values({
        token: randomBytes(32).toString("base64url"),
        playerId: created.id,
        expiresAt: new Date(Date.now() + INVITE_DURATION_MS),
      });
    });
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

const idSchema = z.number().int().positive();

// Gera um convite novo e apaga os pendentes anteriores do jogador — fica no
// máximo um pendente por jogador. Para quem já tem conta, resgatar o convite
// funciona como reset de senha.
export async function createInvite(playerId: number) {
  await requireAdmin();
  const id = idSchema.parse(playerId);
  const [player] = await db.select().from(players).where(eq(players.id, id));
  if (!player || !player.active) return;

  const token = randomBytes(32).toString("base64url");
  await db.transaction(async (tx) => {
    await tx.delete(invites).where(and(eq(invites.playerId, id), isNull(invites.usedAt)));
    await tx.insert(invites).values({
      token,
      playerId: id,
      expiresAt: new Date(Date.now() + INVITE_DURATION_MS),
    });
  });
  revalidatePath("/admin/jogadores");
}

export async function revokeInvite(playerId: number) {
  await requireAdmin();
  const id = idSchema.parse(playerId);
  await db.delete(invites).where(and(eq(invites.playerId, id), isNull(invites.usedAt)));
  revalidatePath("/admin/jogadores");
}

// Desativar a conta derruba a sessão no próximo request (o DAL re-checa
// users.active a cada request) — não precisa mexer em token_version.
export async function setUserActive(userId: number, active: boolean) {
  await requireAdmin();
  const id = idSchema.parse(userId);
  await db.update(users).set({ active: z.boolean().parse(active) }).where(eq(users.id, id));
  revalidatePath("/admin/jogadores");
}
