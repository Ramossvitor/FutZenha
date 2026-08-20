"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { matchDays, players, users } from "@/db/schema";
import { avisoDeFutCriado } from "@/lib/avisos-fut";
import { condicaoElegivel } from "@/lib/elegiveis";
import { podeCriarFutNoGrupo } from "@/lib/grupos-permissions";
import { getGrupo, papelNoGrupo } from "@/lib/grupos";
import { parseMatchDayForm } from "@/lib/match-day-form";
import { notificar } from "@/lib/notifications";
import { agendarDespachoDePush } from "@/lib/push-envio";
import { requirePlayer } from "@/lib/require-player";
import { podeCriarMaisFut } from "@/lib/tetos-de-criacao";

/**
 * Qualquer jogador logado marca um fut — e vira o admin dele.
 *
 * `createdByPlayerId` sai da sessão, nunca do formulário: é ele que decide
 * quem pode sortear, lançar placar e encerrar depois (ver src/lib/permissions.ts).
 *
 * `groupId`, ao contrário, vem do formulário — e por isso é conferido aqui. Sem
 * a checagem de papel, bastaria trocar o valor do <select> no POST para criar
 * fut dentro de um grupo alheio: os gols, as presenças e o V/E/D daquele dia
 * entrariam no ranking de um grupo que nunca ouviu falar de quem criou.
 *
 * Vazio (fut avulso) é o caminho de sempre e não exige nada.
 */
export async function createMatchDay(formData: FormData) {
  const session = await requirePlayer();
  const ator = { playerId: session.player.id, isPlatformAdmin: session.isPlatformAdmin };
  // Antes do parse: o teto não depende do formulário, e recusar cedo evita
  // trabalho à toa. Cada fut é um fan-out de aviso e uma cota de e-mail de
  // agenda própria — ver src/lib/tetos-de-criacao.ts.
  if (!(await podeCriarMaisFut(ator))) redirect("/futs/novo?erro=muitos-futs");

  const parsed = parseMatchDayForm(formData);
  if (!parsed.success) redirect("/futs/novo?erro=dados-invalidos");

  const bruto = formData.get("groupId");
  let groupId: number | null = null;
  if (typeof bruto === "string" && bruto !== "") {
    groupId = Number(bruto);
    if (!Number.isInteger(groupId)) redirect("/futs/novo?erro=dados-invalidos");

    // Grupo tem que existir antes da checagem de papel: `podeCriarFutNoGrupo`
    // devolve true de saída para o admin de plataforma, e `papelNoGrupo` não
    // distingue "grupo apagado" de "não sou membro" — os dois dão null. Sem isto,
    // um groupId morto passava pela permissão e só estourava na FK, virando 500
    // em vez do ?erro= que o resto da action usa.
    if (!(await getGrupo(groupId))) redirect("/futs/novo?erro=dados-invalidos");

    const papel = await papelNoGrupo(groupId, session.player.id);
    if (!podeCriarFutNoGrupo(ator, papel)) {
      redirect("/futs/novo?erro=sem-permissao-no-grupo");
    }
  }

  const created = await db.transaction(async (tx) => {
    const [fut] = await tx
      .insert(matchDays)
      .values({ ...parsed.data, groupId, createdByPlayerId: session.player.id })
      .returning();

    // "Marcaram fut" era a maior lacuna de aviso do app: os elegíveis só
    // descobriam o jogo abrindo o site. Vai para quem tem conta ativa — aviso
    // sem onde ser lido não existe — e não para quem marcou, que já sabe.
    // Dentro da transação como todo notificar(): fut sem aviso ou aviso de
    // fut fantasma, nunca.
    const elegiveis = await tx
      .select({ id: players.id })
      .from(players)
      .innerJoin(users, and(eq(users.playerId, players.id), eq(users.active, true)))
      .where(
        and(
          eq(players.active, true),
          ne(players.id, session.player.id),
          condicaoElegivel({ id: fut.id, groupId }),
        ),
      );
    await notificar(
      tx,
      elegiveis.map((p) => avisoDeFutCriado(fut, p.id)),
    );

    return fut;
  });
  // Fora da transação, como todo despacho: o aviso é fut novo — sensível a
  // tempo, fura o throttle.
  agendarDespachoDePush(true);

  revalidatePath("/");
  revalidatePath("/futs");
  if (groupId) revalidatePath(`/grupo/${groupId}`);
  redirect(`/fut/${created.id}/gerenciar`);
}
