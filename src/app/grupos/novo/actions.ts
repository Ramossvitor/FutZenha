"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { groupMembers, groups } from "@/db/schema";
import { parseGrupoForm } from "@/lib/grupos-form";
import { requirePlayer } from "@/lib/require-player";

/**
 * Qualquer jogador logado cria um grupo — e vira o admin dele.
 *
 * O `role: "admin"` e o `createdByPlayerId` saem da sessão, nunca do
 * formulário: é o papel que decide quem promove organizador, quem aprova
 * pedido de entrada e quem exclui o grupo (ver src/lib/grupos-permissions.ts).
 *
 * O insert do grupo e o do primeiro membro vão na mesma transação porque um
 * grupo sem admin é o pior estado possível: ninguém gerencia, ninguém aprova
 * pedido, e não há tela para consertar — só o admin da plataforma.
 */
export async function criarGrupo(formData: FormData) {
  const session = await requirePlayer();

  const parsed = parseGrupoForm(formData);
  if (!parsed.success) redirect("/grupos/novo?erro=dados-invalidos");

  const groupId = await db.transaction(async (tx) => {
    const [criado] = await tx
      .insert(groups)
      .values({ ...parsed.data, createdByPlayerId: session.player.id })
      .returning();
    await tx.insert(groupMembers).values({
      groupId: criado.id,
      playerId: session.player.id,
      role: "admin",
    });
    return criado.id;
  });

  revalidatePath("/grupos");
  redirect(`/grupo/${groupId}/gerenciar`);
}
