"use server";

import { revalidatePath } from "next/cache";
import { registrarVoto } from "@/lib/deletion";
import { requirePlayer } from "@/lib/require-player";

const mensagens = {
  registrado: undefined,
  "ja-votou": "Você já votou nesta votação, e o voto é definitivo.",
  "nao-elegivel": "Você não jogou esta pelada, então não vota nela.",
  encerrada: "Esta votação já foi encerrada.",
} as const;

export type VotarState = { error?: string; success?: boolean };

// A assinatura recebe o estado anterior porque é chamada via useActionState;
// aqui ele não é usado, já que o resultado depende só do banco.
export async function votar(voteId: number, aFavor: boolean): Promise<VotarState> {
  const session = await requirePlayer();
  const resultado = await registrarVoto(voteId, session.player.id, aFavor);

  revalidatePath(`/votacao/${voteId}`);
  revalidatePath("/avaliar");
  revalidatePath("/peladas");
  revalidatePath("/rankings");

  const erro = mensagens[resultado];
  return erro ? { error: erro } : { success: true };
}
