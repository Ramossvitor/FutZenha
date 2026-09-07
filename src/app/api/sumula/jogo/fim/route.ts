import { revalidateMatchDay } from "@/app/(esqueleto)/fut/[id]/revalidate";
import { fraseDoPlacar } from "@/lib/sumula-relogio";
import * as servico from "@/lib/sumula-servico";
import { comOperador, jogoAbertoDoFut, respostaDeErro, respostaOk } from "../../comum";

// "Fim de jogo" pelo relógio: encerra o jogo em andamento do fut de agora. O
// atalho não sabe o id do jogo, e nem precisa — só existe um aberto por vez.

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return comOperador(request, async (operador) => {
    const jogo = await jogoAbertoDoFut(operador.matchDay.id);
    if (!jogo) return respostaDeErro("jogo-nao-esta-aberto");

    const placar = await servico.finalizarJogo(operador, { gameId: jogo.id });
    revalidateMatchDay(operador.matchDay.id);

    return respostaOk({
      placar: { A: placar.scoreA, B: placar.scoreB },
      mensagem: `Fim de jogo: ${fraseDoPlacar({ timeA: jogo.timeA, timeB: jogo.timeB, ...placar })}`,
    });
  });
}
