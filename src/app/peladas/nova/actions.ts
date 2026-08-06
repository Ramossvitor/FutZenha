"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { matchDays } from "@/db/schema";
import { parseMatchDayForm } from "@/lib/match-day-form";
import { requirePlayer } from "@/lib/require-player";

/**
 * Qualquer jogador logado marca uma pelada — e vira o admin dela.
 *
 * `createdByPlayerId` sai da sessão, nunca do formulário: é ele que decide
 * quem pode sortear, lançar placar e encerrar depois (ver src/lib/permissions.ts).
 */
export async function createMatchDay(formData: FormData) {
  const session = await requirePlayer();
  const parsed = parseMatchDayForm(formData);
  if (!parsed.success) redirect("/peladas/nova?erro=dados-invalidos");

  const [created] = await db
    .insert(matchDays)
    .values({ ...parsed.data, createdByPlayerId: session.player.id })
    .returning();

  revalidatePath("/");
  revalidatePath("/peladas");
  redirect(`/pelada/${created.id}/gerenciar`);
}
