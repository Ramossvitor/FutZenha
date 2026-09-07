import { eq } from "drizzle-orm";
import { revalidateMatchDay } from "@/app/(esqueleto)/fut/[id]/revalidate";
import { db } from "@/db";
import { players } from "@/db/schema";
import { lerInteiro } from "@/lib/sumula-relogio";
import * as servico from "@/lib/sumula-servico";
import { comOperador, jogoAbertoDoFut, respostaDeErro, respostaOk, rotuloDe } from "../comum";

// "Trocar de lado" pelo relógio: o `playerId` vem da lista de `rotulos` do GET
// (do lado em que a pessoa está), e o serviço a passa para o outro — com as
// três escritas e as travas do painel.

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return comOperador(request, async (operador, corpo) => {
    const playerId = lerInteiro(corpo.playerId);
    if (!playerId.ok || playerId.valor === null) return respostaDeErro("dados-invalidos");

    const jogo = await jogoAbertoDoFut(operador.matchDay.id);
    if (!jogo) return respostaDeErro("jogo-nao-esta-aberto");

    const troca = await servico.trocarDeLado(operador, {
      gameId: jogo.id,
      playerId: playerId.valor,
    });
    revalidateMatchDay(operador.matchDay.id);

    const [jogador] = await db
      .select({ nome: players.name, apelido: players.nickname })
      .from(players)
      .where(eq(players.id, playerId.valor));
    const destino = troca.para === "A" ? jogo.timeA : jogo.timeB;
    return respostaOk({
      de: troca.de,
      para: troca.para,
      mensagem: `${jogador ? rotuloDe(jogador) : "Jogador"} foi para o ${destino}`,
    });
  });
}
