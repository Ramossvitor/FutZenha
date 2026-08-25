import "server-only";
import { revalidatePath } from "next/cache";

/**
 * As três telas que qualquer mudança de associação desatualiza.
 *
 * Módulo à parte, e não dentro de ./actions, porque um arquivo `"use server"` só
 * exporta funções async — e esta não precisa ser. Uma definição só, importada
 * também por ./gerenciar/actions: duas cópias divergiriam caladas, e o sintoma
 * (página de grupo velha depois de entrar ou sair) não aponta para a causa.
 *
 * Recebe o SLUG, e não o id: é o caminho que existe no roteador desde que a URL
 * deixou de ser numérica. Revalidar `/grupo/7` hoje não erra nem avisa — apenas
 * não invalida nada, e a tela velha continua servida.
 */
export function revalidateGrupo(slug: string) {
  revalidatePath("/grupos");
  revalidatePath(`/grupo/${slug}`);
  revalidatePath(`/grupo/${slug}/gerenciar`);
}
