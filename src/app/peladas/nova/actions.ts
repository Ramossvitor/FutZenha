"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { matchDays } from "@/db/schema";
import { podeCriarPeladaNoGrupo } from "@/lib/grupos-permissions";
import { getGrupo, papelNoGrupo } from "@/lib/grupos";
import { parseMatchDayForm } from "@/lib/match-day-form";
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

  const [created] = await db
    .insert(matchDays)
    .values({ ...parsed.data, groupId, createdByPlayerId: session.player.id })
    .returning();

  revalidatePath("/");
  revalidatePath("/peladas");
  if (groupId) revalidatePath(`/grupo/${groupId}`);
  redirect(`/pelada/${created.id}/gerenciar`);
}
