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
 * Decide a denúncia — descartar a nota ou mantê-la.
 *
 * Uma action só, e não duas, por causa do campo de observação: um <input> só
 * pertence a um <form>, então com dois formulários o "fica no registro" que o
 * campo promete valia para um botão e era silenciosamente perdido no outro.
 * Agora os dois botões enviam o mesmo formulário e a decisão vem no `value`.
 *
 * Descartar dispara o replay em cascata: a nota de quem foi avaliado naquela
 * fut, e em todas as seguintes, é recalculada. Manter não recalcula nada.
 */
export async function julgarDenuncia(reportId: number, formData: FormData) {
  const session = await requireJulgador(reportId);

  const decisao = formData.get("decisao");
  if (decisao !== "aceitar" && decisao !== "rejeitar") notFound();

  const nota = formData.get("adminNote");
  await db.transaction((tx) =>
    resolverDenuncia(
      tx,
      reportId,
      decisao === "aceitar",
      { tipo: "admin", playerId: session.player.id },
      typeof nota === "string" && nota.trim() !== "" ? nota : undefined,
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
