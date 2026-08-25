"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  GRUPO_COOKIE,
  GRUPO_COOKIE_OPTIONS,
  type DestinoDaTroca,
} from "@/lib/grupo-atual";
import { papelNoGrupo } from "@/lib/grupos";
import { requirePlayer } from "@/lib/require-player";

/**
 * Troca o grupo em que a pessoa está navegando.
 *
 * `groupId` chega pelo `.bind`, ou seja, viaja no corpo do POST e é endereço de
 * cliente — qualquer um monta um POST com o id de um grupo privado do qual não
 * participa. A reconferência do papel é o que impede o cookie de nascer sujo e
 * o nome do grupo de aparecer no cabeçalho de quem não deveria vê-lo.
 *
 * `destino` viaja pelo mesmo caminho e pela mesma razão é uma união fechada, e
 * não um path livre: aceitar string do cliente aqui seria um open redirect de
 * graça, no endpoint que a gente acabou de blindar contra id forjado.
 *
 * `null` volta para "todos os futs", que é o estado sem cookie.
 *
 * O padrão é FICAR. Quem troca pelo seletor do cabeçalho está no meio de outra
 * coisa — em /rankings ou /futs a troca é para comparar, e mandar para o
 * início jogaria fora exatamente o contexto que ela pediu. O hub /grupos é a
 * exceção: lá escolher um grupo É a tarefa, e o fim dela é entrar nele.
 */
export async function trocarGrupo(
  groupId: number | null,
  destino: DestinoDaTroca = "ficar",
) {
  const session = await requirePlayer();
  const store = await cookies();

  if (groupId === null) {
    store.delete(GRUPO_COOKIE);
  } else {
    if (!Number.isInteger(groupId) || groupId <= 0) {
      redirect("/grupos?erro=dados-invalidos");
    }

    const papel = await papelNoGrupo(groupId, session.player.id);
    if (!papel) redirect("/grupos?erro=sem-permissao");

    store.set(GRUPO_COOKIE, String(groupId), GRUPO_COOKIE_OPTIONS);
  }

  // Sem `refresh()` de propósito, e ele não faz falta: mexer no cookie dentro de
  // uma Server Action já marca o request como revalidado, e o Next devolve o RSC
  // novo da rota atual na mesma resposta. `refresh()` depois disso só rebaixaria
  // a marca de "estático e dinâmico" para "só dinâmico".
  if (destino === "ir-para-inicio") redirect("/");
}
