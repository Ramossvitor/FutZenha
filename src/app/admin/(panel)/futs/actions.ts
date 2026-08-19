"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { matchDays } from "@/db/schema";
import {
  agendarCancelamentosPosExclusao,
  lerDestinosDeCancelamento,
} from "@/lib/agenda-convite";
import { apagarFut, motivoExclusaoSchema } from "@/lib/deletion";
import { requirePlatformAdmin } from "@/lib/require-platform-admin";

/**
 * Exclusão de fut pelo admin da plataforma, sem passar pela votação.
 *
 * Existe por causa do que a descentralização abriu: qualquer jogador cria
 * fut, e nada impede alguém de fabricar futs para inflar a própria nota
 * ou a artilharia. A votação de 85% não serve aqui — quem votaria são os
 * "jogadores" do fut fabricado. Este é o botão que desfaz isso, e por ser
 * unilateral fica só com a plataforma e exige motivo escrito.
 */
export async function excluirFutAbusivo(matchDayId: number, formData: FormData) {
  const session = await requirePlatformAdmin();
  const parsed = motivoExclusaoSchema.safeParse(formData.get("motivo") ?? "");
  if (!parsed.success) redirect("/admin/futs?erro=motivo-curto");

  // Confere que o fut existe antes de agir: sem isto um id velho não apagaria
  // nada mas ainda rodaria o aplicarReplay lá dentro — recálculo da nota de todo
  // mundo — e a tela responderia "excluída".
  const id = z.number().int().positive().parse(matchDayId);
  const [fut] = await db.select().from(matchDays).where(eq(matchDays.id, id));
  if (!fut) redirect("/admin/futs");

  // O motivo é a única prestação de contas que esta exclusão tem: ela é
  // unilateral, não passa pela votação do grupo e leva o fut inteiro junto.
  // O formulário promete que fica registrado, então tem de ficar.
  console.warn(
    `[admin] fut ${id} (${fut.date}, ${fut.location}) excluída por ` +
      `${session.username}: ${parsed.data}`,
  );

  const destinos = await db.transaction(async (tx) => {
    // Fut ainda por acontecer está na agenda de quem confirmou — o cancelamento
    // sai junto da exclusão. Encerrado é passado: nada a cancelar.
    const lidos = fut.status === "finished" ? [] : await lerDestinosDeCancelamento(tx, id);
    await apagarFut(tx, id, `nota:abuso:${id}`);
    return lidos;
  });
  agendarCancelamentosPosExclusao(fut, destinos);

  revalidatePath("/");
  revalidatePath("/futs");
  revalidatePath("/rankings");
  revalidatePath("/artilharia");
  redirect("/admin/futs?ok=excluido");
}
