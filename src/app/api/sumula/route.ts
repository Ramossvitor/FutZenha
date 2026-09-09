import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { teams } from "@/db/schema";
import { tempoAtras } from "@/lib/sumula";
import { fraseDoPlacar, rotulosUnicos } from "@/lib/sumula-relogio";
import {
  comOperador,
  escalacaoDoLado,
  jogoAbertoDoFut,
  respostaOk,
  rotuloDe,
  ultimoGolDoLado,
  type Escalado,
} from "./comum";

// A leitura da súmula pelo relógio: o fut de agora, o jogo aberto e a
// escalação — o que um atalho precisa para escolher autor ou quem troca de
// lado. Atenção: /api/* NÃO passa pelo src/proxy.ts; a rota se autentica
// sozinha, e só por Bearer (ver ./comum.ts).
//
// Lê pelos MESMOS helpers que os POSTs (./comum.ts), e não pelo loader do
// painel: o `ultimoGol` que este GET publica é o que "Desfazer A" vai desfazer,
// então os dois têm que sair da mesma consulta — e o painel carrega operadores,
// trocas e candidatos à delegação, que o relógio não usa.
//
// `rotulos` é a mesma escalação em forma de dicionário rótulo → id, porque é
// assim que o app Atalhos escolhe de uma lista: "Escolher da Lista" sobre as
// chaves e "Obter Valor do Dicionário" com a chave escolhida.

// GET com banco e header de autorização é dinâmico por natureza; declarar é
// não depender de o Next perceber.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return comOperador(request, async (operador) => {
    const matchDayId = operador.matchDay.id;
    const [times, jogo] = await Promise.all([
      db
        .select({ id: teams.id, nome: teams.name })
        .from(teams)
        .where(eq(teams.matchDayId, matchDayId))
        .orderBy(asc(teams.sortOrder), asc(teams.id)),
      jogoAbertoDoFut(matchDayId),
    ]);

    const [ladoA, ladoB, ultimoA, ultimoB]: [Escalado[], Escalado[], number | null, number | null] =
      jogo
        ? await Promise.all([
            escalacaoDoLado(jogo.id, "A"),
            escalacaoDoLado(jogo.id, "B"),
            ultimoGolDoLado(jogo.id, "A"),
            ultimoGolDoLado(jogo.id, "B"),
          ])
        : [[], [], null, null];
    const rotular = (lado: Escalado[]) =>
      lado.map((j) => ({ playerId: j.playerId, rotulo: rotuloDe(j) }));
    const escalacaoA = rotular(ladoA);
    const escalacaoB = rotular(ladoB);

    return respostaOk({
      fut: {
        id: matchDayId,
        data: operador.matchDay.date,
        local: operador.matchDay.location,
      },
      jogo:
        jogo === null
          ? null
          : {
              id: jogo.id,
              placar: { A: jogo.scoreA, B: jogo.scoreB },
              times: { A: jogo.timeA, B: jogo.timeB },
              emAndamentoHa: tempoAtras(jogo.segundosEmAndamento),
            },
      times,
      escalacao: { A: escalacaoA, B: escalacaoB },
      rotulos: { A: rotulosUnicos(escalacaoA), B: rotulosUnicos(escalacaoB) },
      ultimoGol: { A: ultimoA, B: ultimoB },
      mensagem: jogo
        ? `Em andamento: ${fraseDoPlacar(jogo)}`
        : `Nenhum jogo em andamento em ${operador.matchDay.location}.`,
    });
  });
}
