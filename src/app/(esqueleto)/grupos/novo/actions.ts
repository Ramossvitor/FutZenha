"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { groupMembers, groups } from "@/db/schema";
import { isUniqueViolation } from "@/lib/db-errors";
import { parseGrupoForm } from "@/lib/grupos-form";
import { requirePlayer } from "@/lib/require-player";
import { slugBase } from "@/lib/slug";
import { slugLivreDeGrupo } from "@/lib/slug-livre";
import { podeCriarMaisGrupo } from "@/lib/tetos-de-criacao";

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
  // Grupo atrás de grupo estreia pares (grupo, jogador) novos, que é o contorno
  // que o dedupe do aviso de convite sozinho não pega — ver
  // src/lib/tetos-de-criacao.ts.
  const ator = { playerId: session.player.id, isPlatformAdmin: session.isPlatformAdmin };
  if (!(await podeCriarMaisGrupo(ator))) redirect("/grupos/novo?erro=muitos-grupos");

  const parsed = parseGrupoForm(formData);
  if (!parsed.success) redirect("/grupos/novo?erro=dados-invalidos");

  let slugDoGrupo: string;
  try {
    slugDoGrupo = await db.transaction(async (tx) => {
      // Dois grupos podem se chamar igual (`groups.name` não é unique), então a
      // colisão de slug aqui é rotina, não exceção: o segundo "Fut da firma" vira
      // "fut-da-firma-2" em silêncio. Nada disso vira erro na tela — é o que
      // impede a unique do slug de virar o oráculo de enumeração que o comentário
      // de `groups.name` (src/db/schema.ts) evita.
      const slug = await slugLivreDeGrupo(tx, slugBase(parsed.data.name, "grupo"));
      const [criado] = await tx
        .insert(groups)
        .values({ ...parsed.data, slug, createdByPlayerId: session.player.id })
        .returning();
      await tx.insert(groupMembers).values({
        groupId: criado.id,
        playerId: session.player.id,
        role: "admin",
      });
      return criado.slug;
    });
  } catch (error) {
    // A corrida que `slugLivreDeGrupo` deixa de propósito para cá (ver o
    // comentário de src/lib/slug-livre.ts): dois envios simultâneos do mesmo
    // nome escolhem o mesmo slug, e o segundo estoura a unique. Vira banner e
    // a pessoa reenvia — como nos callers de criação de jogador.
    if (isUniqueViolation(error)) redirect("/grupos/novo?erro=dados-invalidos");
    throw error;
  }

  revalidatePath("/grupos");
  redirect(`/grupo/${slugDoGrupo}/gerenciar`);
}
