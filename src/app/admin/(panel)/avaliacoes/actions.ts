"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { db } from "@/db";
import { podeJulgarDenuncia } from "@/lib/permissions";
import { fecharRodada } from "@/lib/ratings-engine";
import { julgadorImpedido, resolverDenuncia } from "@/lib/reports";
import { requirePlatformAdmin } from "@/lib/require-platform-admin";
import type { Session } from "@/lib/session";

function revalidarTudo() {
  revalidatePath("/admin/avaliacoes");
  revalidatePath("/admin");
  revalidatePath("/perfil");
  revalidatePath("/rankings");
}

/**
 * Exige o admin da plataforma que não jogou a rodada desta denúncia.
 *
 * A fila já esconde os botões de quem está impedido, mas Server Action é
 * endpoint público e não passa pelo proxy — a decisão tem de ser refeita aqui.
 * 404 em vez de mensagem: quem está impedido não precisa saber mais nada sobre
 * uma denúncia que não é dele para julgar.
 */
async function requireJulgador(reportId: number): Promise<Session> {
  const session = await requirePlatformAdmin();
  const ator = { playerId: session.player.id, isPlatformAdmin: session.isPlatformAdmin };
  const julgadorJogouARodada = await julgadorImpedido(reportId, session.player.id);
  if (!podeJulgarDenuncia(ator, { julgadorJogouARodada })) notFound();
  return session;
}

/**
 * Descarta a nota denunciada. O replay em cascata recalcula todas as rodadas a
 * partir dali — a nota de quem foi avaliado naquela pelada e em todas as
 * seguintes muda junto.
 */
export async function aceitarDenuncia(reportId: number, formData: FormData) {
  const session = await requireJulgador(reportId);
  const nota = formData.get("adminNote");
  await db.transaction((tx) =>
    resolverDenuncia(
      tx,
      reportId,
      true,
      { tipo: "admin", playerId: session.player.id },
      typeof nota === "string" ? nota : undefined,
    ),
  );
  revalidarTudo();
  redirect("/admin/avaliacoes");
}

/** Mantém a nota: o admin analisou e considerou justa. Nada é recalculado. */
export async function rejeitarDenuncia(reportId: number, formData: FormData) {
  const session = await requireJulgador(reportId);
  const nota = formData.get("adminNote");
  await db.transaction((tx) =>
    resolverDenuncia(
      tx,
      reportId,
      false,
      { tipo: "admin", playerId: session.player.id },
      typeof nota === "string" ? nota : undefined,
    ),
  );
  revalidarTudo();
  redirect("/admin/avaliacoes");
}

/**
 * Apura a rodada antes do prazo, sem esperar quem falta. Quem não avaliou fica
 * de fora do cálculo.
 */
export async function apurarAgora(roundId: number) {
  await requirePlatformAdmin();
  await db.transaction((tx) => fecharRodada(tx, roundId, "admin"));
  revalidarTudo();
  redirect("/admin/avaliacoes");
}
