"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { fecharRodada } from "@/lib/ratings-engine";
import { resolverDenuncia } from "@/lib/reports";
import { requireAdmin } from "@/lib/require-admin";

function revalidarTudo() {
  revalidatePath("/admin/avaliacoes");
  revalidatePath("/admin");
  revalidatePath("/perfil");
  revalidatePath("/rankings");
}

/**
 * Descarta a nota denunciada. O replay em cascata recalcula todas as rodadas a
 * partir dali — a nota de quem foi avaliado naquela pelada e em todas as
 * seguintes muda junto.
 */
export async function aceitarDenuncia(reportId: number, formData: FormData) {
  await requireAdmin();
  const nota = formData.get("adminNote");
  await db.transaction((tx) =>
    resolverDenuncia(tx, reportId, true, true, typeof nota === "string" ? nota : undefined),
  );
  revalidarTudo();
  redirect("/admin/avaliacoes");
}

/** Mantém a nota: o admin analisou e considerou justa. Nada é recalculado. */
export async function rejeitarDenuncia(reportId: number, formData: FormData) {
  await requireAdmin();
  const nota = formData.get("adminNote");
  await db.transaction((tx) =>
    resolverDenuncia(tx, reportId, false, true, typeof nota === "string" ? nota : undefined),
  );
  revalidarTudo();
  redirect("/admin/avaliacoes");
}

/**
 * Apura a rodada antes do prazo, sem esperar quem falta. Quem não avaliou fica
 * de fora do cálculo.
 */
export async function apurarAgora(roundId: number) {
  await requireAdmin();
  await db.transaction((tx) => fecharRodada(tx, roundId, "admin"));
  revalidarTudo();
  redirect("/admin/avaliacoes");
}
