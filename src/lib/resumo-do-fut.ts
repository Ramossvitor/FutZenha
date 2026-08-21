import "server-only";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { Executor } from "@/db";
import { gamePlayers, games, goals, players, teamPlayers, teams } from "@/db/schema";
import { montarResumo, type ResumoDoFut } from "./resumo";

// A metade com banco do ./resumo, no par de ./agenda com ./agenda-convite: lá
// mora a derivação (pura, testável), aqui as cinco consultas que a alimentam.

/**
 * O resumo de um fut, pronto para a tela e para o e-mail.
 *
 * **Não chamar dentro da transação do encerramento.** São cinco idas ao banco
 * em paralelo, e a regra da casa é que a transação do encerramento só faça o
 * que precisa ser o mesmo commit (ver confirmarEncerramento). Quem envia o
 * e-mail roda depois, no `after()`, com o `db` global.
 *
 * Recebe o executor mesmo assim, por hábito da família: um dia isto pode ser
 * lido dentro de uma transação de leitura, e trocar a assinatura depois custa
 * mais do que aceitá-lo agora.
 */
export async function getResumoDoFut(
  exec: Executor,
  matchDayId: number,
): Promise<ResumoDoFut> {
  const [listaDeTimes, listaDeJogos] = await Promise.all([
    exec
      .select({ id: teams.id, name: teams.name, sortOrder: teams.sortOrder })
      .from(teams)
      .where(eq(teams.matchDayId, matchDayId))
      .orderBy(asc(teams.sortOrder)),
    exec
      .select({
        id: games.id,
        teamAId: games.teamAId,
        teamBId: games.teamBId,
        scoreA: games.scoreA,
        scoreB: games.scoreB,
        sortOrder: games.sortOrder,
        startedAt: games.startedAt,
        finishedAt: games.finishedAt,
      })
      .from(games)
      .where(eq(games.matchDayId, matchDayId))
      .orderBy(asc(games.sortOrder), asc(games.id)),
  ]);

  const idsDeJogos = listaDeJogos.map((j) => j.id);
  const idsDeTimes = listaDeTimes.map((t) => t.id);

  // `inArray` com lista vazia gera SQL inválido — e fut sem jogo (ou sem
  // sorteio) é caso real, não borda teórica: o encerramento aceita os dois.
  const [listaDeGols, escalacao, elencos] = await Promise.all([
    idsDeJogos.length === 0
      ? []
      : exec
          .select({
            gameId: goals.gameId,
            // leftJoin: gol sem autor (gol contra, ou ninguém viu quem foi) tem
            // player_id nulo e continua sendo gol. Gol desfeito no painel é
            // soft-delete e fica de fora — só a auditoria do admin o vê.
            playerId: players.id,
            playerName: players.name,
            nickname: players.nickname,
            quantity: goals.quantity,
            side: goals.side,
          })
          .from(goals)
          .leftJoin(players, eq(goals.playerId, players.id))
          .where(and(inArray(goals.gameId, idsDeJogos), isNull(goals.desfeitoEm))),
    idsDeJogos.length === 0
      ? []
      : exec
          .select({
            gameId: gamePlayers.gameId,
            playerId: gamePlayers.playerId,
            side: gamePlayers.side,
          })
          .from(gamePlayers)
          .where(inArray(gamePlayers.gameId, idsDeJogos)),
    idsDeTimes.length === 0
      ? []
      : exec
          .select({
            teamId: teamPlayers.teamId,
            playerId: players.id,
            name: players.name,
            nickname: players.nickname,
            isGoalkeeper: players.isGoalkeeper,
          })
          .from(teamPlayers)
          .innerJoin(players, eq(teamPlayers.playerId, players.id))
          .where(inArray(teamPlayers.teamId, idsDeTimes)),
  ]);

  return montarResumo({
    times: listaDeTimes,
    jogos: listaDeJogos,
    gols: listaDeGols,
    escalacao,
    elencos,
  });
}
