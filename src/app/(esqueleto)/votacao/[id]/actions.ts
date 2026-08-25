"use server";

import { revalidatePath } from "next/cache";
import type { VotarState } from "@/components/ui/votar-form";
import { registrarVoto } from "@/lib/deletion";
import { esquecerStats } from "@/lib/stats";
import { requirePlayer } from "@/lib/require-player";

const mensagens = {
  registrado: undefined,
  "ja-votou": "Você já votou nesta votação, e o voto é definitivo.",
  "nao-elegivel": "Você não jogou este fut, então não vota nele.",
  encerrada: "Esta votação já foi encerrada.",
} as const;

// A assinatura recebe o estado anterior porque é chamada via useActionState;
// aqui ele não é usado, já que o resultado depende só do banco.
export async function votar(voteId: number, aFavor: boolean): Promise<VotarState> {
  const session = await requirePlayer();
  const resultado = await registrarVoto(voteId, session.player.id, aFavor);

  revalidatePath(`/votacao/${voteId}`);
  revalidatePath("/avaliar");
  revalidatePath("/futs");
  revalidatePath("/rankings");
  // O memo de src/lib/stats.ts guarda os agregados por até MEMO_TTL_MS; sem
  // isto, o ranking e o perfil público ficariam com o número velho por esse
  // tempo depois de uma mudança que os afeta.
  esquecerStats();

  const erro = mensagens[resultado];
  return erro ? { error: erro } : { success: true };
}
