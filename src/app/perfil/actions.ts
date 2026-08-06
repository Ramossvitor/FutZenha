"use server";

import { revalidatePath } from "next/cache";
import { and, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { ratingReports, ratingRounds, ratings, users } from "@/db/schema";
import { createSessionToken } from "@/lib/auth";
import { isUniqueViolation } from "@/lib/db-errors";
import { hashPassword, verifyPassword } from "@/lib/password";
import {
  MIN_AVALIACOES_PARA_DENUNCIAR,
  PRAZO_ADMIN_DIAS,
  prazoEmDias,
  resolverAvaliacaoPorIndice,
} from "@/lib/ratings";
import { requirePlayer } from "@/lib/require-player";
import { setSessionCookie } from "@/lib/session";

export type DenunciarState = { error?: string; success?: boolean };

const reasonSchema = z.string().trim().max(500).optional();

/**
 * Denuncia uma nota recebida. O jogador manda a POSIÇÃO na lista, não o id da
 * avaliação: `ratings.id` é serial e entregaria a ordem de envio. O servidor
 * repete a mesma ordenação anônima da tela para descobrir de qual avaliação se
 * trata.
 */
export async function denunciarAvaliacao(
  roundId: number,
  indice: number,
  _prev: DenunciarState,
  formData: FormData,
): Promise<DenunciarState> {
  const session = await requirePlayer();
  const parsedReason = reasonSchema.safeParse(formData.get("reason") ?? undefined);
  if (!parsedReason.success) return { error: "Motivo longo demais." };

  // A rodada precisa estar apurada e dentro do prazo de contestação.
  const [rodada] = await db
    .select({ id: ratingRounds.id })
    .from(ratingRounds)
    .where(
      and(
        eq(ratingRounds.id, roundId),
        eq(ratingRounds.status, "closed"),
        gt(ratingRounds.reportDeadlineAt, sql`now()`),
      ),
    );
  if (!rodada) return { error: "O prazo para contestar esta rodada já passou." };

  const recebidas = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(ratings)
    .where(and(eq(ratings.roundId, roundId), eq(ratings.ratedPlayerId, session.player.id)));
  if ((recebidas[0]?.total ?? 0) < MIN_AVALIACOES_PARA_DENUNCIAR) {
    return {
      error: `Só dá para reportar quando você recebeu ao menos ${MIN_AVALIACOES_PARA_DENUNCIAR} avaliações na rodada.`,
    };
  }

  // Uma denúncia por rodada, não uma por nota recebida. A unique em
  // rating_id sozinha só impede reportar a *mesma* nota duas vezes — sem esta
  // checagem dava para reportar todas as estrelas da rodada de uma vez e, com
  // o auto-aceite por silêncio do admin, anular a pelada inteira.
  const [jaDenunciou] = await db
    .select({ id: ratingReports.id })
    .from(ratingReports)
    .innerJoin(ratings, eq(ratingReports.ratingId, ratings.id))
    .where(
      and(
        eq(ratings.roundId, roundId),
        eq(ratingReports.reporterPlayerId, session.player.id),
      ),
    );
  if (jaDenunciou) return { error: "Você já reportou uma nota desta rodada." };

  const ratingId = await resolverAvaliacaoPorIndice(roundId, session.player.id, indice);
  if (ratingId === null) return { error: "Avaliação não encontrada." };

  try {
    await db.insert(ratingReports).values({
      ratingId,
      reporterPlayerId: session.player.id,
      // O .trim() do schema já é transform de saída no Zod 4.
      reason: parsedReason.data || null,
      adminDeadlineAt: prazoEmDias(PRAZO_ADMIN_DIAS),
    });
  } catch (error) {
    // Só a unique em rating_id vira mensagem. Qualquer outra falha (conexão
    // caída no cold start do Neon, FK) tem que subir: reportá-la como
    // duplicata faria o jogador desistir de um envio que nunca aconteceu.
    if (isUniqueViolation(error)) return { error: "Esta nota já foi reportada." };
    throw error;
  }

  revalidatePath("/perfil");
  return { success: true };
}

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
  await setSessionCookie(await createSessionToken({ sub: user.id, v: tokenVersion }));
  return { success: true };
}
