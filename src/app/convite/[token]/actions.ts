"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { invites, players, users } from "@/db/schema";
import { createSessionToken } from "@/lib/auth";
import { hashPassword } from "@/lib/password";
import { setSessionCookie } from "@/lib/session";

export type ClaimState = { error?: string };

const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z0-9._-]{2,20}$/,
    "Nome de usuário inválido: use 2 a 20 caracteres entre letras minúsculas, números, ponto, hífen ou _.",
  );

const passwordSchema = z
  .string()
  .min(6, "A senha precisa de pelo menos 6 caracteres.")
  .max(100, "Senha longa demais.");

// O drizzle embrulha o erro do driver (DrizzleQueryError → cause) — percorre a
// cadeia de cause atrás do código 23505 do Postgres.
function isUniqueViolation(error: unknown): boolean {
  while (typeof error === "object" && error !== null) {
    if ("code" in error && error.code === "23505") return true;
    error = (error as { cause?: unknown }).cause;
  }
  return false;
}

// Resgata um convite: cria a conta do jogador ou, se ela já existe, redefine a
// senha (o admin ter gerado o convite é a autorização — inclusive reativa a
// conta). Tudo é revalidado aqui dentro; o GET da página não vale nada no POST.
export async function claimInvite(
  token: string,
  _prev: ClaimState,
  formData: FormData,
): Promise<ClaimState> {
  const tokenParsed = z.string().min(1).max(100).safeParse(token);
  if (!tokenParsed.success) return { error: "Convite inválido ou expirado." };

  const [invite] = await db.select().from(invites).where(eq(invites.token, tokenParsed.data));
  if (!invite || invite.usedAt !== null || invite.expiresAt.getTime() <= Date.now()) {
    return { error: "Convite inválido ou expirado. Fala com o admin para gerar outro." };
  }

  const [player] = await db.select().from(players).where(eq(players.id, invite.playerId));
  if (!player || !player.active) return { error: "Jogador inativo — fala com o admin." };

  const passwordParsed = passwordSchema.safeParse(formData.get("password"));
  if (!passwordParsed.success) return { error: passwordParsed.error.issues[0].message };
  if (passwordParsed.data !== formData.get("confirm")) {
    return { error: "As senhas não coincidem." };
  }

  const [existingUser] = await db.select().from(users).where(eq(users.playerId, invite.playerId));
  const passwordHash = await hashPassword(passwordParsed.data);
  const usedAt = new Date();

  let sub: number;
  let tokenVersion: number;

  if (existingUser) {
    // Reset de senha: token_version novo derruba as sessões antigas.
    tokenVersion = existingUser.tokenVersion + 1;
    sub = existingUser.id;
    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ passwordHash, tokenVersion, active: true })
        .where(eq(users.id, existingUser.id));
      await tx.update(invites).set({ usedAt }).where(eq(invites.id, invite.id));
    });
  } else {
    const usernameParsed = usernameSchema.safeParse(formData.get("username"));
    if (!usernameParsed.success) return { error: usernameParsed.error.issues[0].message };
    try {
      const created = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(users)
          .values({ playerId: invite.playerId, username: usernameParsed.data, passwordHash })
          .returning();
        await tx.update(invites).set({ usedAt }).where(eq(invites.id, invite.id));
        return row;
      });
      sub = created.id;
      tokenVersion = created.tokenVersion;
    } catch (error) {
      if (isUniqueViolation(error)) return { error: "Esse nome de usuário já está em uso." };
      throw error;
    }
  }

  await setSessionCookie(await createSessionToken({ role: "player", sub, v: tokenVersion }));
  redirect("/");
}
