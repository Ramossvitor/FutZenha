"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { invites, players, users } from "@/db/schema";
import { criarJogadorComConvite, gerarConvite } from "@/lib/convites";
import { isUniqueViolation } from "@/lib/db-errors";
import { requirePlatformAdmin } from "@/lib/require-platform-admin";

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

// Cadastrar já cria o convite (ver src/lib/convites.ts); o botão de gerar
// convite segue existindo para reenviar quando o prazo vencer.
export async function createPlayer(formData: FormData) {
  await requirePlatformAdmin();
  const parsed = parsePlayerForm(formData);
  if (!parsed.success) redirect("/admin/jogadores?erro=dados-invalidos");

  try {
    await db.transaction((tx) => criarJogadorComConvite(tx, parsed.data));
  } catch (error) {
    if (isUniqueViolation(error)) redirect("/admin/jogadores?erro=nome-duplicado");
    throw error;
  }
  revalidatePath("/admin/jogadores");
  redirect("/admin/jogadores");
}

export async function updatePlayer(playerId: number, formData: FormData) {
  await requirePlatformAdmin();
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
  await requirePlatformAdmin();
  await db.update(players).set({ active }).where(eq(players.id, playerId));
  revalidatePath("/admin/jogadores");
}

const idSchema = z.number().int().positive();

// Convite para quem já tem conta é reset de senha — por isso esta action é
// exclusiva da plataforma. É o único caminho que chega em `gerarConvite` com um
// jogador que pode já ter conta; o do admin da pelada só cria jogador novo.
export async function createInvite(playerId: number) {
  await requirePlatformAdmin();
  const id = idSchema.parse(playerId);
  const [player] = await db.select().from(players).where(eq(players.id, id));
  if (!player || !player.active) return;

  await db.transaction((tx) => gerarConvite(tx, id));
  revalidatePath("/admin/jogadores");
}

export async function revokeInvite(playerId: number) {
  await requirePlatformAdmin();
  const id = idSchema.parse(playerId);
  await db.delete(invites).where(and(eq(invites.playerId, id), isNull(invites.usedAt)));
  revalidatePath("/admin/jogadores");
}

// Desativar a conta derruba a sessão no próximo request (o DAL re-checa
// users.active a cada request) — não precisa mexer em token_version.
export async function setUserActive(userId: number, active: boolean) {
  await requirePlatformAdmin();
  const id = idSchema.parse(userId);
  await db.update(users).set({ active: z.boolean().parse(active) }).where(eq(users.id, id));
  revalidatePath("/admin/jogadores");
}

/**
 * Promove ou rebaixa um admin da plataforma.
 *
 * Existe porque só havia caminho de ida: o `npm run build` liga a flag de quem
 * está em `PLATFORM_ADMIN_USERNAMES` e nunca desliga, então uma conta que
 * virasse admin ficaria admin para sempre — tirar o username da env var não
 * rebaixa, porque a flag já está gravada. Sem isto, o único jeito de conter um
 * admin comprometido era desativar a conta inteira, o que é bem mais do que
 * tirar o papel.
 *
 * Vale já no request seguinte, sem derrubar a sessão: o papel é lido do banco a
 * cada request pelo getSession, não do cookie.
 *
 * Rebaixar a si mesmo é recusado: seria um tiro no pé silencioso, e alguém
 * precisa sobrar com a chave. Quem está na env var não é rebaixável pela flag —
 * a env var é chave-mestra e vence o banco (ver src/lib/session.ts).
 */
export async function setPlatformAdmin(userId: number, isPlatformAdmin: boolean) {
  const session = await requirePlatformAdmin();
  const id = idSchema.parse(userId);
  if (id === session.userId) redirect("/admin/jogadores?erro=auto-rebaixamento");

  await db
    .update(users)
    .set({ isPlatformAdmin: z.boolean().parse(isPlatformAdmin) })
    .where(eq(users.id, id));
  revalidatePath("/admin/jogadores");
}
