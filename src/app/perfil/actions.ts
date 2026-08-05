"use server";

import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createSessionToken } from "@/lib/auth";
import { hashPassword, verifyPassword } from "@/lib/password";
import { requirePlayer } from "@/lib/require-player";
import { setSessionCookie } from "@/lib/session";

export type ChangePasswordState = { error?: string; success?: boolean };

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Informe a senha atual."),
  newPassword: z
    .string()
    .min(6, "A nova senha precisa de pelo menos 6 caracteres.")
    .max(100, "Senha longa demais."),
  confirm: z.string(),
});

export async function changePassword(
  _prev: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  const session = await requirePlayer();

  const parsed = changePasswordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { currentPassword, newPassword, confirm } = parsed.data;
  if (newPassword !== confirm) return { error: "As senhas não coincidem." };

  // O hash nunca vive na sessão — re-busca aqui na hora de conferir.
  const [user] = await db.select().from(users).where(eq(users.id, session.userId));
  if (!user) return { error: "Conta não encontrada." };
  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    return { error: "Senha atual incorreta." };
  }

  const tokenVersion = user.tokenVersion + 1;
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(newPassword), tokenVersion })
    .where(eq(users.id, user.id));

  // token_version novo derruba as outras sessões; reemite o próprio cookie na
  // mesma action, senão este usuário se desloga sozinho no próximo request.
  await setSessionCookie(
    await createSessionToken({ role: "player", sub: user.id, v: tokenVersion }),
  );
  return { success: true };
}
