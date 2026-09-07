import { inArray } from "drizzle-orm";
import { revalidateMatchDay } from "@/app/(esqueleto)/fut/[id]/revalidate";
import { db } from "@/db";
import { teams } from "@/db/schema";
import { fraseDoPlacar, lerInteiro } from "@/lib/sumula-relogio";
import * as servico from "@/lib/sumula-servico";
import { comOperador, doisPrimeirosTimes, respostaDeErro, respostaOk } from "../comum";

// "Novo jogo" pelo relógio. Sem `teamAId`/`teamBId` no corpo, abre com os dois
// primeiros times do sorteio — o mesmo default dos selects do painel, e o caso
// comum de um fut de dois times, em que o atalho não precisa perguntar nada.

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return comOperador(request, async (operador, corpo) => {
    const a = lerInteiro(corpo.teamAId);
    const b = lerInteiro(corpo.teamBId);
    if (!a.ok || !b.ok) return respostaDeErro("dados-invalidos");

    let teamAId = a.valor;
    let teamBId = b.valor;
    if (teamAId === null && teamBId === null) {
      [teamAId = null, teamBId = null] = await doisPrimeirosTimes(operador.matchDay.id);
    }
    // Um só dos dois, ou fut com menos de dois times: não há jogo a abrir.
    if (teamAId === null || teamBId === null) return respostaDeErro("dados-invalidos");

    const jogo = await servico.iniciarJogo(operador, { teamAId, teamBId });
    revalidateMatchDay(operador.matchDay.id);

    const nomes = new Map(
      (
        await db
          .select({ id: teams.id, name: teams.name })
          .from(teams)
          .where(inArray(teams.id, [teamAId, teamBId]))
      ).map((t) => [t.id, t.name]),
    );
    const times = { A: nomes.get(teamAId) ?? "", B: nomes.get(teamBId) ?? "" };
    return respostaOk({
      jogo: { id: jogo.id, times },
      placar: { A: 0, B: 0 },
      mensagem: `Jogo aberto: ${fraseDoPlacar({ timeA: times.A, timeB: times.B, scoreA: 0, scoreB: 0 })}`,
    });
  });
}
