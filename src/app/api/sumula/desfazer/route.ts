import { revalidateMatchDay } from "@/app/(esqueleto)/fut/[id]/revalidate";
import { fraseDoPlacar, lerInteiro, lerLado } from "@/lib/sumula-relogio";
import * as servico from "@/lib/sumula-servico";
import {
  comOperador,
  jogoAbertoDoFut,
  respostaDeErro,
  respostaOk,
  ultimoGolDoLado,
} from "../comum";

// "Desfazer" pelo relógio. O atalho manda o LADO, e o servidor acha o último
// gol ativo dele — é o único que o delegado pode desfazer, e o que o admin
// quase sempre quer. `goalId` explícito também vale (é o `ultimoGol` do GET, ou
// qualquer outro, para o admin); a regra de quem pode desfazer o quê é a do
// serviço, a mesma do painel.
//
// Ou um, ou outro: `side` E `goalId` juntos é pedido contraditório — o id pode
// ser de um gol do outro lado, e desfazê-lo respondendo "desfeito o gol do
// lado X" seria confirmar o que não foi pedido. A mesma regra de `playerId` +
// `autor` no gol.

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return comOperador(request, async (operador, corpo) => {
    const side = lerLado(corpo.side);
    const goalIdLido = lerInteiro(corpo.goalId);
    if (!goalIdLido.ok) return respostaDeErro("dados-invalidos");
    if ((goalIdLido.valor === null) === (side === null)) return respostaDeErro("dados-invalidos");

    const jogo = await jogoAbertoDoFut(operador.matchDay.id);
    if (!jogo) return respostaDeErro("jogo-nao-esta-aberto");

    // Pelo lado, o "último" é lido aqui fora e reafirmado no UPDATE do serviço
    // (`exigirUltimoDoLado`): se o painel lançou no mesmo lado entre esta
    // leitura e o commit, o gol lido já não é o último, e a recusa vale para
    // o admin também — desfazer o mais antigo em silêncio tiraria o gol do
    // autor errado sem ninguém perceber.
    const peloLado = side !== null;
    const goalId = side !== null ? await ultimoGolDoLado(jogo.id, side) : goalIdLido.valor;
    if (goalId === null) return respostaDeErro("sem-gol-para-desfazer");

    const resultado = await servico.desfazerLancamento(operador, {
      goalId,
      exigirUltimoDoLado: peloLado,
    });
    revalidateMatchDay(operador.matchDay.id);

    const time = resultado.side === "A" ? jogo.timeA : jogo.timeB;
    const placar = fraseDoPlacar({ timeA: jogo.timeA, timeB: jogo.timeB, ...resultado });
    return respostaOk({
      goalId,
      placar: { A: resultado.scoreA, B: resultado.scoreB },
      mensagem: `Desfeito o gol do ${time} — ${placar}`,
    });
  });
}
