"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { GRUPO_COOKIE, GRUPO_COOKIE_OPTIONS } from "@/lib/grupo-atual";
import { papelNoGrupo } from "@/lib/grupos";
import { requirePlayer } from "@/lib/require-player";

/**
 * Para onde ir depois de trocar de grupo.
 *
 * Mapa fechado, e não uma rota livre como o `next` do login: aqui o destino não
 * vem de fora, são três lugares conhecidos. `destinoSeguro` existe para o login,
 * onde o `next` chega de um link que a gente não controla e por isso precisa ser
 * genérico — usá-lo aqui seria abrir uma superfície que este botão não precisa.
 */
const DESTINOS = {
  inicio: "/",
  peladas: "/peladas",
  rankings: "/rankings",
} as const;

export type DestinoContexto = keyof typeof DESTINOS;

/**
 * Troca o grupo em que a pessoa está navegando.
 *
 * `groupId` chega pelo `.bind`, ou seja, viaja no corpo do POST e é endereço de
 * cliente — qualquer um monta um POST com o id de um grupo privado do qual não
 * participa. A reconferência do papel é o que impede o cookie de nascer sujo e
 * o nome do grupo de aparecer no cabeçalho de quem não deveria vê-lo.
 *
 * `null` volta para "todas as peladas", que é o estado sem cookie.
 */
export async function trocarGrupo(
  groupId: number | null,
  destino: DestinoContexto = "inicio",
) {
  const session = await requirePlayer();
  const store = await cookies();

  if (groupId === null) {
    store.delete(GRUPO_COOKIE);
    redirect(DESTINOS[destino] ?? DESTINOS.inicio);
  }

  if (!Number.isInteger(groupId) || groupId <= 0) {
    redirect("/grupos?erro=dados-invalidos");
  }

  const papel = await papelNoGrupo(groupId, session.player.id);
  if (!papel) redirect("/grupos?erro=sem-permissao");

  store.set(GRUPO_COOKIE, String(groupId), GRUPO_COOKIE_OPTIONS);
  redirect(DESTINOS[destino] ?? DESTINOS.inicio);
}
