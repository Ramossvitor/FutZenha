"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { GRUPO_COOKIE, GRUPO_COOKIE_OPTIONS } from "@/lib/grupo-atual";
import { papelNoGrupo } from "@/lib/grupos";
import { requirePlayer } from "@/lib/require-player";

/**
 * Troca o grupo em que a pessoa está navegando e volta para a home.
 *
 * `groupId` chega pelo `.bind`, ou seja, viaja no corpo do POST e é endereço de
 * cliente — qualquer um monta um POST com o id de um grupo privado do qual não
 * participa. A reconferência do papel é o que impede o cookie de nascer sujo e
 * o nome do grupo de aparecer no cabeçalho de quem não deveria vê-lo.
 *
 * `null` volta para "todas as peladas", que é o estado sem cookie.
 */
export async function trocarGrupo(groupId: number | null) {
  const session = await requirePlayer();
  const store = await cookies();

  if (groupId === null) {
    store.delete(GRUPO_COOKIE);
    redirect("/");
  }

  if (!Number.isInteger(groupId) || groupId <= 0) {
    redirect("/grupos?erro=dados-invalidos");
  }

  const papel = await papelNoGrupo(groupId, session.player.id);
  if (!papel) redirect("/grupos?erro=sem-permissao");

  store.set(GRUPO_COOKIE, String(groupId), GRUPO_COOKIE_OPTIONS);
  redirect("/");
}
