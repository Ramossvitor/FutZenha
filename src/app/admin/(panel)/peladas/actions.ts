"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { matchDays } from "@/db/schema";
import { apagarPelada, motivoExclusaoSchema } from "@/lib/deletion";
import { requirePlatformAdmin } from "@/lib/require-platform-admin";

/**
 * Exclusão de pelada pelo admin da plataforma, sem passar pela votação.
 *
 * Existe por causa do que a descentralização abriu: qualquer jogador cria
 * pelada, e nada impede alguém de fabricar peladas para inflar a própria nota
 * ou a artilharia. A votação de 85% não serve aqui — quem votaria são os
 * "jogadores" da pelada fabricada. Este é o botão que desfaz isso, e por ser
 * unilateral fica só com a plataforma e exige motivo escrito.
 */
export async function excluirPeladaAbusiva(matchDayId: number, formData: FormData) {
  const session = await requirePlatformAdmin();
  const parsed = motivoExclusaoSchema.safeParse(formData.get("motivo") ?? "");
  if (!parsed.success) redirect("/admin/peladas?erro=motivo-curto");

  // Confere que a pelada existe antes de agir: sem isto um id velho não apagaria
  // nada mas ainda rodaria o aplicarReplay lá dentro — recálculo da nota de todo
  // mundo — e a tela responderia "excluída".
  const id = z.number().int().positive().parse(matchDayId);
  const [pelada] = await db.select().from(matchDays).where(eq(matchDays.id, id));
  if (!pelada) redirect("/admin/peladas");

  // O motivo é a única prestação de contas que esta exclusão tem: ela é
  // unilateral, não passa pela votação do grupo e leva a pelada inteira junto.
  // O formulário promete que fica registrado, então tem de ficar.
  console.warn(
    `[admin] pelada ${id} (${pelada.date}, ${pelada.location}) excluída por ` +
      `${session.username}: ${parsed.data}`,
  );

  await db.transaction((tx) => apagarPelada(tx, id, `nota:abuso:${id}`));

  revalidatePath("/");
  revalidatePath("/peladas");
  revalidatePath("/rankings");
  revalidatePath("/artilharia");
  redirect("/admin/peladas?ok=excluida");
}
