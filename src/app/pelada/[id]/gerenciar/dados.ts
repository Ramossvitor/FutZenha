import "server-only";
import { notFound } from "next/navigation";
import { and, asc, eq, getTableColumns, gt, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  attendances,
  gamePlayers,
  games,
  goals,
  invites,
  matchDays,
  players,
  teamPlayers,
  teams,
  users,
} from "@/db/schema";
import { getFaltamVotar, getVotacaoDaPelada } from "@/lib/deletion";

/**
 * Tudo o que o painel precisa, numa função só.
 *
 * Ficava no corpo da página, misturado a 500 linhas de JSX. Separar deixa as
 * seções serem componentes burros — recebem dados e desenham — e torna óbvio
 * o que cada consulta serve.
 */
export async function carregarPainel(matchDayId: number) {
  // Uma onda só para tudo o que depende apenas do id — o painel fazia 6 níveis
  // de await em série e era a rota mais pesada do app.
  const [[matchDay], activePlayers, attendanceRows, teamList, gameList, votacao, convitesParaEntregar] =
    await Promise.all([
      // A janela de correção vem calculada pelo Postgres — a regra de pureza do
      // React proíbe Date.now() durante o render.
      db
        .select({
          ...getTableColumns(matchDays),
          segundosDeJanela: sql<number>`greatest(0, extract(epoch from (
            ${matchDays.finishedAt} + interval '24 hours' - now()
          ))::int)`,
        })
        .from(matchDays)
        .where(eq(matchDays.id, matchDayId)),
      db.select().from(players).where(eq(players.active, true)).orderBy(asc(players.name)),
      db.select().from(attendances).where(eq(attendances.matchDayId, matchDayId)),
      db.select().from(teams).where(eq(teams.matchDayId, matchDayId)).orderBy(asc(teams.sortOrder)),
      db
        .select()
        .from(games)
        .where(eq(games.matchDayId, matchDayId))
        .orderBy(asc(games.sortOrder), asc(games.id)),
      getVotacaoDaPelada(matchDayId),
      // Os convites de quem está nesta pelada e ainda não tem conta. É o que torna o
      // "cadastrar quem chegou" utilizável: quem organiza precisa do link na mão
      // para mandar no WhatsApp — e, com o envio configurado, reenviar por e-mail
      // daqui mesmo (ver reenviarConviteDaPelada). O leftJoin com `users` + isNull
      // é o que mantém a regra: convite para quem já tem conta é reset de senha, e
      // isso é da plataforma — não passa por aqui.
      db
        .select({
          token: invites.token,
          expiresAt: invites.expiresAt,
          name: players.name,
          playerId: invites.playerId,
          email: invites.email,
          emailSentAt: invites.emailSentAt,
        })
        .from(invites)
        .innerJoin(players, eq(players.id, invites.playerId))
        .innerJoin(attendances, eq(attendances.playerId, invites.playerId))
        .leftJoin(users, eq(users.playerId, invites.playerId))
        .where(
          and(
            eq(attendances.matchDayId, matchDayId),
            isNull(invites.usedAt),
            isNull(users.id),
            gt(invites.expiresAt, sql`now()`),
          ),
        )
        .orderBy(asc(players.name)),
    ]);

  // O requirePeladaAdmin da página viu a pelada existir, mas ela pode ter sido
  // apagada entre o guard e esta query (votação aprovada, admin da plataforma).
  // Sem isto, `matchDay.finishedAt` virava TypeError em vez de 404.
  if (!matchDay) notFound();

  const dentroDaJanela = matchDay.finishedAt !== null && matchDay.segundosDeJanela > 0;
  // Placar e gols não mexem em quem avalia quem, então sobrevivem ao
  // encerramento por 24h. A escalação, não: some do formulário na hora.
  const podeEditarPlacar = matchDay.status !== "finished" || dentroDaJanela;

  const statusByPlayer = new Map(attendanceRows.map((a) => [a.playerId, a.status]));
  const confirmed = activePlayers.filter((p) => statusByPlayer.get(p.id) === "in");
  const gameIds = gameList.map((g) => g.id);

  const [teamMembers, goalRows, lineupRows] = await Promise.all([
    teamList.length > 0
      ? db
          .select({
            teamId: teamPlayers.teamId,
            playerId: players.id,
            playerName: players.name,
            nickname: players.nickname,
            skill: players.skill,
            isGoalkeeper: players.isGoalkeeper,
          })
          .from(teamPlayers)
          .innerJoin(players, eq(teamPlayers.playerId, players.id))
          .where(
            inArray(
              teamPlayers.teamId,
              teamList.map((t) => t.id),
            ),
          )
          .orderBy(asc(players.name))
      : Promise.resolve([]),
    gameIds.length > 0
      ? db
          .select({
            id: goals.id,
            gameId: goals.gameId,
            quantity: goals.quantity,
            playerName: players.name,
            nickname: players.nickname,
          })
          .from(goals)
          .innerJoin(players, eq(goals.playerId, players.id))
          .where(inArray(goals.gameId, gameIds))
      : Promise.resolve([]),
    // Escalação real de cada jogo — é ela, e não o colete da pelada, que diz
    // quem entrou em campo por qual lado.
    gameIds.length > 0
      ? db
          .select({
            gameId: gamePlayers.gameId,
            playerId: gamePlayers.playerId,
            side: gamePlayers.side,
            playerName: players.name,
            nickname: players.nickname,
          })
          .from(gamePlayers)
          .innerJoin(players, eq(gamePlayers.playerId, players.id))
          .where(inArray(gamePlayers.gameId, gameIds))
          .orderBy(asc(players.name))
      : Promise.resolve([]),
  ]);

  // Só o número sai da função: os nomes de quem ainda não votou nunca chegam à
  // tela, senão o cruzamento com o placar entrega o voto de cada um.
  const faltamVotar = votacao?.status === "open" ? (await getFaltamVotar(votacao.id)).length : 0;

  return {
    matchDay,
    dentroDaJanela,
    podeEditarPlacar,
    activePlayers,
    statusByPlayer,
    confirmed,
    teamList,
    teamMembers,
    gameList,
    goalRows,
    lineupRows,
    teamNameById: new Map(teamList.map((t) => [t.id, t.name])),
    votacao,
    faltamVotar,
    convitesParaEntregar,
  };
}

export type PainelDaPelada = Awaited<ReturnType<typeof carregarPainel>>;
