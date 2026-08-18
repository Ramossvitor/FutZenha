import "server-only";
import { revalidatePath } from "next/cache";

/**
 * As telas que qualquer mudança num fut desatualiza.
 *
 * Módulo à parte, e não dentro de ./gerenciar/actions, porque um arquivo
 * `"use server"` só exporta funções async — e esta não precisa ser. Mesma
 * decisão do src/app/grupo/[id]/revalidate.ts, e pela mesma razão: uma
 * definição só, importada pelos três arquivos de actions do fut. Enquanto
 * eram duas cópias, o /sumula ficou de fora da lista do /gerenciar e todo
 * conserto de gol pelo painel do admin deixava a súmula ao vivo servindo
 * cache velho — o sintoma não apontava para a causa.
 */
export function revalidateMatchDay(matchDayId: number) {
  revalidatePath("/");
  revalidatePath("/futs");
  revalidatePath(`/fut/${matchDayId}`);
  revalidatePath(`/fut/${matchDayId}/gerenciar`);
  revalidatePath(`/fut/${matchDayId}/sumula`);
}
