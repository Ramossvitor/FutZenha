import "server-only";
import { notFound } from "next/navigation";
import { and, asc, eq, getTableColumns, gt, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
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
import { getFaltamVotar, getJanelaAberturaExclusao, getVotacaoDoFut } from "@/lib/deletion";
import { jogadoresElegiveis } from "@/lib/elegiveis";
import { FIM_DA_JANELA_CORRECAO } from "@/lib/janela-correcao";
import { repartirLista } from "@/lib/lista-presenca";

// Quem lançou e quem desfez cada gol na súmula ao vivo — duas pontas
// diferentes da mesma tabela de jogadores.
const lancador = alias(players, "lancador");
const desfazedor = alias(players, "desfazedor");

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
  const [
    [matchDay],
    attendanceRows,
    teamList,
    gameList,
    votacao,
    janelaExclusao,
    convitesParaEntregar,
  ] = await Promise.all([
      // A janela de correção vem calculada pelo Postgres — a regra de pureza do
      // React proíbe Date.now() durante o render.
      db
        .select({
          ...getTableColumns(matchDays),
          segundosDeJanela: sql<number>`greatest(0, extract(epoch from (
            ${FIM_DA_JANELA_CORRECAO} - now()
          ))::int)`,
        })
        .from(matchDays)
        .where(eq(matchDays.id, matchDayId)),
      db.select().from(attendances).where(eq(attendances.matchDayId, matchDayId)),
      db.select().from(teams).where(eq(teams.matchDayId, matchDayId)).orderBy(asc(teams.sortOrder)),
      db
        .select()
        .from(games)
        .where(eq(games.matchDayId, matchDayId))
        .orderBy(asc(games.sortOrder), asc(games.id)),
      getVotacaoDoFut(matchDayId),
      getJanelaAberturaExclusao(db, matchDayId),
      // Os convites de quem está neste fut e ainda não tem conta. É o que torna o
      // "cadastrar quem chegou" utilizável: quem organiza precisa do link na mão
      // para mandar no WhatsApp — e, com o envio configurado, reenviar por e-mail
      // daqui mesmo (ver reenviarConviteDoFut). O leftJoin com `users` + isNull
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

  // O requireFutAdmin da página viu o fut existir, mas ele pode ter sido
  // apagado entre o guard e esta query (votação aprovada, admin da plataforma).
  // Sem isto, `matchDay.finishedAt` virava TypeError em vez de 404.
  if (!matchDay) notFound();

  const dentroDaJanela = matchDay.finishedAt !== null && matchDay.segundosDeJanela > 0;
  // Placar e gols não mexem em quem avalia quem, então sobrevivem ao
  // encerramento pela janela de correção. A escalação, não: some do formulário
  // na hora.
  const podeEditarPlacar = matchDay.status !== "finished" || dentroDaJanela;

  const statusByPlayer = new Map(attendanceRows.map((a) => [a.playerId, a.status]));
  const gameIds = gameList.map((g) => g.id);

  const [activePlayers, teamMembers, goalRows, lineupRows] = await Promise.all([
    // Depende do `groupId`, então só dá para pedir depois de o fut chegar —
    // por isso está na segunda onda e não na primeira.
    jogadoresElegiveis(matchDay),
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
            // leftJoin: gol sem autor (gol contra / ninguém viu, vindo da
            // súmula ao vivo) tem player_id nulo e ainda assim aparece na
            // lista — o `side` gravado é o que diz de que lado ele saiu.
            playerName: players.name,
            nickname: players.nickname,
            side: goals.side,
            // A auditoria da súmula, inclusive os desfeitos: aqui é onde o
            // admin investiga abuso, então as remoções aparecem riscadas em
            // vez de sumirem. Todo OUTRO leitor filtra `desfeito_em is null`.
            desfeito: sql<boolean>`${goals.desfeitoEm} is not null`,
            lancadoPor: lancador.nickname,
            lancadoPorNome: lancador.name,
            desfeitoPor: desfazedor.nickname,
            desfeitoPorNome: desfazedor.name,
          })
          .from(goals)
          .leftJoin(players, eq(goals.playerId, players.id))
          .leftJoin(lancador, eq(goals.createdByPlayerId, lancador.id))
          .leftJoin(desfazedor, eq(goals.desfeitoPorPlayerId, desfazedor.id))
          .where(inArray(goals.gameId, gameIds))
      : Promise.resolve([]),
    // Escalação real de cada jogo — é ela, e não o colete do fut, que diz
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

  // A lista repartida sai daqui pronta, para as seções continuarem burras —
  // recebem dados e desenham. Quem tem linha mas não está elegível é jogador
  // desativado, e some da tela como sempre somiu.
  const jogadorPorId = new Map(activePlayers.map((p) => [p.id, p]));
  const lista = repartirLista(attendanceRows.filter((a) => jogadorPorId.has(a.playerId)));
  const confirmed = lista.vagas.map((l) => jogadorPorId.get(l.playerId)!);

  return {
    matchDay,
    dentroDaJanela,
    podeEditarPlacar,
    activePlayers,
    jogadorPorId,
    lista,
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
    janelaExclusao,
    convitesParaEntregar,
  };
}

export type PainelDoFut = Awaited<ReturnType<typeof carregarPainel>>;
