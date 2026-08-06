import "server-only";
import { revalidatePath } from "next/cache";

/**
 * As três telas que qualquer mudança de associação desatualiza.
 *
 * Módulo à parte, e não dentro de ./actions, porque um arquivo `"use server"` só
 * exporta funções async — e esta não precisa ser. Uma definição só, importada
 * também por ./gerenciar/actions: duas cópias divergiriam caladas, e o sintoma
 * (página de grupo velha depois de entrar ou sair) não aponta para a causa.
 */
export function revalidateGrupo(groupId: number) {
  revalidatePath("/grupos");
  revalidatePath(`/grupo/${groupId}`);
  revalidatePath(`/grupo/${groupId}/gerenciar`);
}
