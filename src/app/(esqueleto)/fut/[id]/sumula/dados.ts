import "server-only";
import { and, asc, desc, eq, getTableColumns, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import {
  gamePlayers,
  games,
  goals,
  players,
  sumulaOperadores,
  teams,
  trocasDeLado,
  type MatchDay,
} from "@/db/schema";
import { jogoEmAndamento } from "@/lib/sumula";
import { elegiveisParaSumula } from "@/lib/sumula-elegiveis";

/**
 * Tudo o que o painel da súmula precisa, já no formato serializável que o
 * client component recebe. Os tempos relativos ("há N s") vêm calculados pelo
 * Postgres — a regra de pureza do render proíbe Date.now(), e o relógio do
 * banco é o mesmo que carimbou os eventos, então não há skew.
 */
export async function carregarSumula(matchDay: MatchDay, ehAdminDoFut: boolean) {
  const matchDayId = matchDay.id;

  const [teamList, gameList, operadores, presentes] = await Promise.all([
    db.select().from(teams).where(eq(teams.matchDayId, matchDayId)).orderBy(asc(teams.sortOrder)),
    db
      .select({
        ...getTableColumns(games),
        segundosEmAndamento: sql<number | null>`
          case when ${games.startedAt} is not null and ${games.finishedAt} is null
            then extract(epoch from (now() - ${games.startedAt}))::int
          end`,
      })
      .from(games)
      .where(eq(games.matchDayId, matchDayId))
      .orderBy(asc(games.sortOrder), asc(games.id)),
    // A lista de quem tem a súmula e quem passou — só a seção do admin usa,
    // mas a consulta é barata e o guard já decidiu o papel.
    carregarOperadores(matchDayId),
    // Candidatos a receber a súmula: a MESMA condição que delegarSumula exige e
    // que o guard reafirma (src/lib/sumula-elegiveis.ts), para o select não
    // oferecer quem a action recusaria.
    ehAdminDoFut ? elegiveisParaSumula(matchDayId) : Promise.resolve([]),
  ]);

  const aberto = gameList.find(jogoEmAndamento) ?? null;

  const [lineupRows, lancamentoRows, trocaRows] = await Promise.all([
    aberto
      ? db
          .select({
            playerId: gamePlayers.playerId,
            side: gamePlayers.side,
            nome: players.name,
            apelido: players.nickname,
          })
          .from(gamePlayers)
          .innerJoin(players, eq(gamePlayers.playerId, players.id))
          .where(eq(gamePlayers.gameId, aberto.id))
          .orderBy(asc(players.name))
      : Promise.resolve([]),
    aberto ? carregarLancamentos(aberto.id) : Promise.resolve([]),
    aberto ? carregarTrocas(aberto.id) : Promise.resolve([]),
  ]);

  const jaOperam = new Set(operadores.map((o) => o.playerId));
  return {
    teamList,
    gameList,
    aberto,
    lineupRows,
    lancamentoRows,
    trocaRows,
    operadores,
    // Quem já tem a súmula (ou é o próprio admin) sai do select de delegação.
    candidatos: presentes.filter(
      (p) => !jaOperam.has(p.playerId) && p.playerId !== matchDay.createdByPlayerId,
    ),
  };
}

async function carregarOperadores(matchDayId: number) {
  const delegante = alias(players, "delegante");
  return db
    .select({
      playerId: sumulaOperadores.playerId,
      nome: players.name,
      apelido: players.nickname,
      delegadoPor: delegante.name,
    })
    .from(sumulaOperadores)
    .innerJoin(players, eq(sumulaOperadores.playerId, players.id))
    .leftJoin(delegante, eq(sumulaOperadores.createdByPlayerId, delegante.id))
    .where(eq(sumulaOperadores.matchDayId, matchDayId))
    .orderBy(asc(players.name));
}

/**
 * Os lançamentos do jogo aberto, do mais recente para o mais antigo — inclusive
 * os desfeitos, que aparecem riscados com quem desfez: a auditoria visível é
 * parte do desenho anti-abuso, todo operador vê o que todo operador fez.
 *
 * `somado_no_placar` recorta o que o painel governa: só o que a súmula lançou,
 * porque só isso ela pode desfazer devolvendo o placar. Gol vindo do addGoal do
 * /gerenciar aparece lá, não aqui — listá-lo daria um botão Desfazer que
 * comeria do placar ao vivo o que aquele gol nunca somou.
 */
async function carregarLancamentos(gameId: number) {
  const autor = alias(players, "autor");
  const lancador = alias(players, "lancador");
  const desfazedor = alias(players, "desfazedor");
  return db
    .select({
      id: goals.id,
      side: goals.side,
      autorNome: autor.name,
      autorApelido: autor.nickname,
      lancadoPor: lancador.name,
      lancadoPorApelido: lancador.nickname,
      desfeito: sql<boolean>`${goals.desfeitoEm} is not null`,
      desfeitoPor: desfazedor.name,
      desfeitoPorApelido: desfazedor.nickname,
      segundosAtras: sql<number>`extract(epoch from (now() - ${goals.createdAt}))::int`,
      // O instante do lançamento, para intercalar com as trocas de lado — as
      // duas tabelas têm sequências próprias, então o id não serve de relógio
      // entre elas (ver montarLinhaDoTempo em src/lib/sumula.ts).
      //
      // `float8`, e não o `::int` dos segundos aí em cima: `extract(epoch ...)`
      // devolve `numeric`, que o driver entrega como STRING — e uma string aqui
      // faria a ordenação comparar texto. O float ainda guarda a fração de
      // segundo, que é o que separa dois toques dentro do mesmo segundo.
      criadoEm: sql<number>`extract(epoch from ${goals.createdAt})::float8`,
    })
    .from(goals)
    .leftJoin(autor, eq(goals.playerId, autor.id))
    .leftJoin(lancador, eq(goals.createdByPlayerId, lancador.id))
    .leftJoin(desfazedor, eq(goals.desfeitoPorPlayerId, desfazedor.id))
    .where(and(eq(goals.gameId, gameId), eq(goals.somadoNoPlacar, true)))
    .orderBy(desc(goals.id));
}

/**
 * As trocas de lado do jogo aberto — o outro evento que a linha do tempo mostra.
 *
 * Tudo o que aconteceu, sem filtro: a troca não tem desfazer (voltar é trocar
 * de novo), e é justamente a sequência das idas e vindas que conta a história
 * de um jogo remendado.
 */
async function carregarTrocas(gameId: number) {
  const jogador = alias(players, "trocado");
  const operador = alias(players, "trocador");
  return db
    .select({
      id: trocasDeLado.id,
      playerId: trocasDeLado.playerId,
      de: trocasDeLado.deLado,
      para: trocasDeLado.paraLado,
      jogadorNome: jogador.name,
      jogadorApelido: jogador.nickname,
      porNome: operador.name,
      porApelido: operador.nickname,
      segundosAtras: sql<number>`extract(epoch from (now() - ${trocasDeLado.createdAt}))::int`,
      // Ver o `criadoEm` dos lançamentos: `float8` porque `numeric` chega como
      // string, e é este número que ordena a linha do tempo.
      criadoEm: sql<number>`extract(epoch from ${trocasDeLado.createdAt})::float8`,
    })
    .from(trocasDeLado)
    .innerJoin(jogador, eq(trocasDeLado.playerId, jogador.id))
    .leftJoin(operador, eq(trocasDeLado.createdByPlayerId, operador.id))
    .where(eq(trocasDeLado.gameId, gameId))
    .orderBy(desc(trocasDeLado.id));
}
