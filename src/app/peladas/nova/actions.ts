"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { matchDays, players, users } from "@/db/schema";
import { avisoDePeladaCriada } from "@/lib/avisos-pelada";
import { condicaoElegivel } from "@/lib/elegiveis";
import { podeCriarPeladaNoGrupo } from "@/lib/grupos-permissions";
import { getGrupo, papelNoGrupo } from "@/lib/grupos";
import { parseMatchDayForm } from "@/lib/match-day-form";
import { notificar } from "@/lib/notifications";
import { agendarDespachoDePush } from "@/lib/push-envio";
import { requirePlayer } from "@/lib/require-player";

/**
 * Qualquer jogador logado marca uma pelada — e vira o admin dela.
 *
 * `createdByPlayerId` sai da sessão, nunca do formulário: é ele que decide
 * quem pode sortear, lançar placar e encerrar depois (ver src/lib/permissions.ts).
 *
 * `groupId`, ao contrário, vem do formulário — e por isso é conferido aqui. Sem
 * a checagem de papel, bastaria trocar o valor do <select> no POST para criar
 * pelada dentro de um grupo alheio: os gols, as presenças e o V/E/D daquele dia
 * entrariam no ranking de um grupo que nunca ouviu falar de quem criou.
 *
 * Vazio (pelada avulsa) é o caminho de sempre e não exige nada.
 */
export async function createMatchDay(formData: FormData) {
  const session = await requirePlayer();
  const parsed = parseMatchDayForm(formData);
  if (!parsed.success) redirect("/peladas/nova?erro=dados-invalidos");

  const bruto = formData.get("groupId");
  let groupId: number | null = null;
  if (typeof bruto === "string" && bruto !== "") {
    groupId = Number(bruto);
    if (!Number.isInteger(groupId)) redirect("/peladas/nova?erro=dados-invalidos");

    // Grupo tem que existir antes da checagem de papel: `podeCriarPeladaNoGrupo`
    // devolve true de saída para o admin de plataforma, e `papelNoGrupo` não
    // distingue "grupo apagado" de "não sou membro" — os dois dão null. Sem isto,
    // um groupId morto passava pela permissão e só estourava na FK, virando 500
    // em vez do ?erro= que o resto da action usa.
    if (!(await getGrupo(groupId))) redirect("/peladas/nova?erro=dados-invalidos");

    const ator = { playerId: session.player.id, isPlatformAdmin: session.isPlatformAdmin };
    const papel = await papelNoGrupo(groupId, session.player.id);
    if (!podeCriarPeladaNoGrupo(ator, papel)) {
      redirect("/peladas/nova?erro=sem-permissao-no-grupo");
    }
  }

  const created = await db.transaction(async (tx) => {
    const [pelada] = await tx
      .insert(matchDays)
      .values({ ...parsed.data, groupId, createdByPlayerId: session.player.id })
      .returning();

    // "Marcaram pelada" era a maior lacuna de aviso do app: os elegíveis só
    // descobriam o jogo abrindo o site. Vai para quem tem conta ativa — aviso
    // sem onde ser lido não existe — e não para quem marcou, que já sabe.
    // Dentro da transação como todo notificar(): pelada sem aviso ou aviso de
    // pelada fantasma, nunca.
    const elegiveis = await tx
      .select({ id: players.id })
      .from(players)
      .innerJoin(users, and(eq(users.playerId, players.id), eq(users.active, true)))
      .where(
        and(
          eq(players.active, true),
          ne(players.id, session.player.id),
          condicaoElegivel({ id: pelada.id, groupId }),
        ),
      );
    await notificar(
      tx,
      elegiveis.map((p) => avisoDePeladaCriada(pelada, p.id)),
    );

    return pelada;
  });
  // Fora da transação, como todo despacho: o aviso é pelada nova — sensível a
  // tempo, fura o throttle.
  agendarDespachoDePush(true);

  revalidatePath("/");
  revalidatePath("/peladas");
  if (groupId) revalidatePath(`/grupo/${groupId}`);
  redirect(`/pelada/${created.id}/gerenciar`);
}
