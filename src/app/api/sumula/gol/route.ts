import { revalidateMatchDay } from "@/app/(esqueleto)/fut/[id]/revalidate";
import { fraseDoPlacar, lerInteiro, lerLado, resolverAutor } from "@/lib/sumula-relogio";
import * as servico from "@/lib/sumula-servico";
import {
  comOperador,
  escalacaoDoLado,
  jogoAbertoDoFut,
  respostaDeErro,
  respostaOk,
  rotuloDe,
} from "../comum";

// "Gol" pelo relógio. O autor vem de dois jeitos, ou de nenhum:
//
// - `playerId`: o atalho escolheu da lista de `rotulos` do GET;
// - `autor`: o atalho DITOU um nome, e o servidor o procura na escalação
//   daquele lado (src/lib/sumula-relogio.ts). Não achou, ou achou dois
//   parecidos: recusa e NADA é lançado — creditar o gol à pessoa errada é o
//   único erro que o desfazer não conserta sozinho, porque ninguém percebe;
// - nenhum dos dois: gol contra / sem autor, como o botão do painel.
//
// Os dois juntos é pedido contraditório, e 400.

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return comOperador(request, async (operador, corpo) => {
    const side = lerLado(corpo.side);
    if (!side) return respostaDeErro("dados-invalidos");

    const playerId = lerInteiro(corpo.playerId);
    if (!playerId.ok) return respostaDeErro("dados-invalidos");

    const autorDitado = typeof corpo.autor === "string" ? corpo.autor.trim() : "";
    if (corpo.autor !== undefined && corpo.autor !== null && typeof corpo.autor !== "string") {
      return respostaDeErro("dados-invalidos");
    }
    if (playerId.valor !== null && autorDitado !== "") return respostaDeErro("dados-invalidos");

    const jogo = await jogoAbertoDoFut(operador.matchDay.id);
    if (!jogo) return respostaDeErro("jogo-nao-esta-aberto");

    // A escalação do lado serve às duas coisas: resolver o nome ditado e
    // rotular o autor na resposta. Se o `playerId` não estiver nela, o serviço
    // recusa com `artilheiro-fora-do-jogo` — a mesma trava do painel.
    const escalacao = await escalacaoDoLado(jogo.id, side);
    let autorId = playerId.valor;
    if (autorId === null && autorDitado !== "") {
      const achado = resolverAutor(autorDitado, escalacao);
      if (!achado.ok) return respostaDeErro("autor-nao-encontrado");
      autorId = achado.playerId;
    }

    const resultado = await servico.lancarGol(operador, {
      gameId: jogo.id,
      side,
      playerId: autorId,
    });
    revalidateMatchDay(operador.matchDay.id);

    const autor = escalacao.find((j) => j.playerId === autorId);
    const rotulo = autor ? rotuloDe(autor) : null;
    const time = side === "A" ? jogo.timeA : jogo.timeB;
    const placar = fraseDoPlacar({ timeA: jogo.timeA, timeB: jogo.timeB, ...resultado });
    return respostaOk({
      goalId: resultado.goalId,
      placar: { A: resultado.scoreA, B: resultado.scoreB },
      autor: rotulo,
      mensagem: `Gol do ${time}${rotulo ? ` (${rotulo})` : ""} — ${placar}`,
    });
  });
}
