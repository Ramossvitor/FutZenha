import "server-only";
import { inArray, sql } from "drizzle-orm";
import { type Executor } from "@/db";
import { gamePlayers, games, teamPlayers, type Game } from "@/db/schema";

/**
 * Cria o jogo e tira o snapshot da escalação — os dois caminhos de nascimento
 * de um jogo passam por aqui: o clássico do /gerenciar (placar digitado
 * pronto, `createGame`) e a súmula ao vivo (0×0 em andamento, `iniciarJogo`).
 * Extraído para os dois não divergirem justamente no snapshot, que é a fonte
 * do V/E/D e do universo de avaliação.
 *
 * A escalação é copiada de `team_players` AGORA — depois disso ela é editável
 * por jogo e independente do colete (ver o comentário de game_players no
 * schema). A leitura roda no mesmo executor de quem chama, e os DOIS chamadores
 * abrem transação com o fut travado (travarFut) antes de chegar aqui — é isso
 * que garante que ninguém troque o time entre a leitura e o insert. Um chamador
 * novo que esqueça o lock corre com o drawTeamsAction e grava escalação errada,
 * que não é cosmético: game_players é a fonte do V/E/D e do universo de
 * avaliação.
 *
 * `emAndamento` é o que separa os dois fluxos: true grava `started_at = now()`
 * (via SQL — regra do projeto: nunca Date do JS em timestamp de domínio) e o
 * jogo passa a existir como "em andamento" para a súmula.
 */
export async function criarJogoComEscalacao(
  exec: Executor,
  args: {
    matchDayId: number;
    teamAId: number;
    teamBId: number;
    scoreA: number;
    scoreB: number;
    sortOrder: number;
    emAndamento?: boolean;
  },
): Promise<Game> {
  const lineup = await exec
    .select({ playerId: teamPlayers.playerId, teamId: teamPlayers.teamId })
    .from(teamPlayers)
    .where(inArray(teamPlayers.teamId, [args.teamAId, args.teamBId]));

  const [created] = await exec
    .insert(games)
    .values({
      matchDayId: args.matchDayId,
      teamAId: args.teamAId,
      teamBId: args.teamBId,
      scoreA: args.scoreA,
      scoreB: args.scoreB,
      sortOrder: args.sortOrder,
      startedAt: args.emAndamento ? sql`now()` : null,
    })
    .returning();

  if (lineup.length > 0) {
    await exec.insert(gamePlayers).values(
      lineup.map((row) => ({
        gameId: created.id,
        playerId: row.playerId,
        side: row.teamId === args.teamAId ? ("A" as const) : ("B" as const),
      })),
    );
  }

  return created;
}
