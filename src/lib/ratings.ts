import "server-only";
import { and, desc, eq, inArray, isNotNull, isNull, ne, sql, type SQL } from "drizzle-orm";
import { db, type Executor } from "@/db";
import {
  gamePlayers,
  games,
  matchDays,
  players,
  ratingReports,
  ratingRoundRaters,
  ratingRounds,
  ratings,
  skillHistory,
  users,
  type RatingRound,
} from "@/db/schema";
import { ordenarAnonimo } from "./anonimato";
import { companheirosPorJogador, gruposElegiveis, type EscalacaoRow } from "./lineup";
import { apurarMvp, type CandidatoApurado } from "./mvp";
// Os prazos moraram aqui até ganharem um módulo puro (src/lib/regras.ts), que a
// página /guia consegue importar sem arrastar o banco. Sem re-export de volta
// para cá: quem quer a constante importa de regras.ts direto, e não através
// deste módulo `server-only`. Aqui fica só o que este arquivo usa.
import { MIN_AVALIACOES_PARA_DENUNCIAR } from "./regras";

/** `now() + N horas` calculado pelo Postgres, não pelo relógio do app. */
export function prazoEmHoras(horas: number) {
  return sql<Date>`now() + make_interval(hours => ${horas}::int)`;
}

/**
 * Recebe o executor porque roda tanto solto (telas de avaliação) quanto dentro
 * da transação de encerrar o fut — e usar o `db` global de dentro de uma
 * transação, com pool pequeno, é pedir para a query esperar a conexão que a
 * própria transação reservou (deadlock de encerramento que travava produção).
 */
export async function getEscalacaoDoFut(
  exec: Executor,
  matchDayId: number,
): Promise<EscalacaoRow[]> {
  return exec
    .select({
      gameId: gamePlayers.gameId,
      playerId: gamePlayers.playerId,
      side: gamePlayers.side,
    })
    .from(gamePlayers)
    .innerJoin(games, eq(gamePlayers.gameId, games.id))
    .where(eq(games.matchDayId, matchDayId));
}

export type Companheiro = {
  playerId: number;
  name: string;
  nickname: string | null;
  isGoalkeeper: boolean;
};

/**
 * Quem o jogador avalia neste fut: todos que dividiram o lado com ele em
 * algum jogo **e têm conta ativa**. Quem ainda não resgatou o convite jogou,
 * mas não é avaliado — e por isso nem aparece na lista. Vazio se ele não jogou
 * ou se nenhum companheiro tem conta.
 */
export async function getCompanheiros(
  matchDayId: number,
  playerId: number,
): Promise<Companheiro[]> {
  const companheiros = companheirosPorJogador(await getEscalacaoDoFut(db, matchDayId));
  const ids = [...(companheiros.get(playerId) ?? [])];
  if (ids.length === 0) return [];

  return db
    .select({
      playerId: players.id,
      name: players.name,
      nickname: players.nickname,
      isGoalkeeper: players.isGoalkeeper,
    })
    .from(players)
    .innerJoin(users, and(eq(users.playerId, players.id), eq(users.active, true)))
    .where(inArray(players.id, ids))
    .orderBy(players.name);
}

export type CandidatoMvp = {
  playerId: number;
  name: string;
  nickname: string | null;
  isGoalkeeper: boolean;
};

/**
 * Em quem se pode votar de melhor em campo: todos que entraram em campo no
 * fut (os dois lados, direto de game_players) e têm conta ativa — a mesma
 * regra de "só quem tem conta é avaliado" das notas —, exceto o próprio
 * votante. O check no banco (rating_round_raters_mvp_no_self_check) repete a
 * exclusão do próprio, como o ratings_no_self_check faz nas notas.
 */
export async function getCandidatosMvp(
  matchDayId: number,
  exceptPlayerId: number,
): Promise<CandidatoMvp[]> {
  return db
    .selectDistinct({
      playerId: players.id,
      name: players.name,
      nickname: players.nickname,
      isGoalkeeper: players.isGoalkeeper,
    })
    .from(gamePlayers)
    .innerJoin(games, eq(gamePlayers.gameId, games.id))
    .innerJoin(players, eq(gamePlayers.playerId, players.id))
    .innerJoin(users, and(eq(users.playerId, players.id), eq(users.active, true)))
    .where(and(eq(games.matchDayId, matchDayId), ne(players.id, exceptPlayerId)))
    .orderBy(players.name);
}

/**
 * A casa ÚNICA dos agregados que a apuração pura (apurarMvp) consome, rodada a
 * rodada: votos por votado e a média de meias-estrelas que cada um recebeu na
 * própria rodada, sem as descartadas. O fechamento (getAgregadosMvp) e o
 * ranking (getMvpRanking, em stats.ts) derivam DAQUI — mudar a elegibilidade
 * do voto ou a regra do descarte num lugar só mantém as duas telas de acordo.
 *
 * O innerJoin com `users` ativo no VOTADO é o mesmo filtro de todos os
 * rankings: conta desativada entre o voto e a apuração não pode vencer.
 * `cond` filtra sobre rating_rounds/match_days: a rodada exata no fechamento,
 * o escopo de grupo/ano/status no ranking.
 */
export async function getAgregadosMvpPorRodada(
  exec: Executor,
  cond: SQL | undefined,
): Promise<Map<number, CandidatoApurado[]>> {
  const votos = await exec
    .select({
      roundId: ratingRoundRaters.roundId,
      playerId: ratingRoundRaters.mvpPlayerId,
      votos: sql<number>`count(*)::int`,
    })
    .from(ratingRoundRaters)
    .innerJoin(ratingRounds, eq(ratingRoundRaters.roundId, ratingRounds.id))
    .innerJoin(matchDays, eq(ratingRounds.matchDayId, matchDays.id))
    .innerJoin(
      users,
      and(eq(users.playerId, ratingRoundRaters.mvpPlayerId), eq(users.active, true)),
    )
    .where(and(cond, isNotNull(ratingRoundRaters.mvpPlayerId)))
    .groupBy(ratingRoundRaters.roundId, ratingRoundRaters.mvpPlayerId);

  if (votos.length === 0) return new Map();

  const medias = await exec
    .select({
      roundId: ratings.roundId,
      ratedPlayerId: ratings.ratedPlayerId,
      media: sql<number>`avg(${ratings.halfStars})::float8`,
    })
    .from(ratings)
    .innerJoin(ratingRounds, eq(ratings.roundId, ratingRounds.id))
    .innerJoin(matchDays, eq(ratingRounds.matchDayId, matchDays.id))
    .where(and(cond, isNull(ratings.discardedAt)))
    .groupBy(ratings.roundId, ratings.ratedPlayerId);
  const mediaPorRodadaEJogador = new Map(
    medias.map((m) => [`${m.roundId}:${m.ratedPlayerId}`, m.media]),
  );

  const porRodada = new Map<number, CandidatoApurado[]>();
  for (const v of votos) {
    const candidato: CandidatoApurado = {
      // O isNotNull do where garante; o narrowing é só para o tipo.
      playerId: v.playerId!,
      votos: v.votos,
      mediaMeias: mediaPorRodadaEJogador.get(`${v.roundId}:${v.playerId}`) ?? null,
    };
    const lista = porRodada.get(v.roundId);
    if (lista) lista.push(candidato);
    else porRodada.set(v.roundId, [candidato]);
  }
  return porRodada;
}

/**
 * Os agregados de UMA rodada — o que o fechamento apura. Recebe o executor
 * porque roda dentro da transação que fecha a rodada.
 */
export async function getAgregadosMvp(
  exec: Executor,
  roundId: number,
): Promise<CandidatoApurado[]> {
  const porRodada = await getAgregadosMvpPorRodada(exec, eq(ratingRounds.id, roundId));
  return porRodada.get(roundId) ?? [];
}

export type MvpDoFut = { playerId: number; slug: string; name: string; nickname: string | null };

/**
 * O(s) melhor(es) em campo de um fut já apurado, para exibição. Vazio quando a
 * rodada ainda corre, não existe, ninguém votou ou os votos contados ficaram
 * abaixo do piso (MIN_VOTOS_PARA_MVP). Derivado na leitura, nunca
 * materializado — o título, como a nota, é função das avaliações que sobraram.
 */
export async function getMvpDoFut(matchDayId: number): Promise<MvpDoFut[]> {
  const [rodada] = await db
    .select({ id: ratingRounds.id })
    .from(ratingRounds)
    .where(and(eq(ratingRounds.matchDayId, matchDayId), eq(ratingRounds.status, "closed")));
  if (!rodada) return [];

  const vencedores = apurarMvp(await getAgregadosMvp(db, rodada.id));
  if (vencedores.length === 0) return [];

  return db
    .select({
      playerId: players.id,
      slug: players.slug,
      name: players.name,
      nickname: players.nickname,
    })
    .from(players)
    .innerJoin(users, and(eq(users.playerId, players.id), eq(users.active, true)))
    .where(inArray(players.id, vencedores))
    .orderBy(players.name);
}

export type RaterElegivel = { playerId: number; userId: number };

/**
 * Quem pode avaliar num fut: jogou, tem conta ativa e dividiu o lado com
 * gente com conta suficiente para o grupo chegar a `MIN_GRUPO_AVALIACAO`. Vira
 * o denominador congelado do "todos já avaliaram".
 *
 * A condição do grupo faz dois trabalhos. O primeiro é velho: sem ela, alguém
 * cujos companheiros estejam todos com o convite pendente entraria como
 * avaliador de uma lista vazia, sem ter o que enviar — e a rodada nunca
 * fecharia por completude. O segundo é o que a abertura do "qualquer um cria
 * fut" exigiu: com o mínimo em 2, duas contas combinadas fabricavam nota
 * (ver src/lib/lineup.ts).
 */
export async function getRatersElegiveis(
  exec: Executor,
  matchDayId: number,
): Promise<RaterElegivel[]> {
  const companheiros = companheirosPorJogador(await getEscalacaoDoFut(exec, matchDayId));
  const jogaram = [...companheiros.keys()];
  if (jogaram.length === 0) return [];

  const contas = await exec
    .select({ playerId: users.playerId, userId: users.id })
    .from(users)
    .where(and(inArray(users.playerId, jogaram), eq(users.active, true)));

  const comConta = new Set(contas.map((c) => c.playerId));
  const elegiveis = gruposElegiveis(companheiros, comConta);
  return contas.filter((c) => elegiveis.has(c.playerId));
}

export type RodadaAberta = {
  round: RatingRound;
  matchDayDate: string;
  location: string;
  jaEnviou: boolean;
  /** Calculado pelo Postgres: o render não pode chamar Date.now(). */
  horasRestantes: number;
};

/** Rodadas abertas em que este jogador é um dos avaliadores esperados. */
export async function getRodadasAbertasDoJogador(playerId: number): Promise<RodadaAberta[]> {
  const rows = await db
    .select({
      round: ratingRounds,
      matchDayDate: matchDays.date,
      location: matchDays.location,
      submittedAt: ratingRoundRaters.submittedAt,
      horasRestantes: sql<number>`greatest(0, ceil(extract(epoch from (
        ${ratingRounds.deadlineAt} - now()
      )) / 3600)::int)`,
    })
    .from(ratingRoundRaters)
    .innerJoin(ratingRounds, eq(ratingRoundRaters.roundId, ratingRounds.id))
    .innerJoin(matchDays, eq(ratingRounds.matchDayId, matchDays.id))
    .where(and(eq(ratingRoundRaters.playerId, playerId), eq(ratingRounds.status, "open")))
    .orderBy(ratingRounds.deadlineAt);

  return rows.map((r) => ({
    round: r.round,
    matchDayDate: r.matchDayDate,
    location: r.location,
    jaEnviou: r.submittedAt !== null,
    horasRestantes: r.horasRestantes,
  }));
}

/** O que este jogador já enviou nesta rodada (em meias-estrelas), para
 *  reabrir o formulário. */
export async function getMinhasAvaliacoes(
  roundId: number,
  raterPlayerId: number,
): Promise<Map<number, number>> {
  const rows = await db
    .select({ ratedPlayerId: ratings.ratedPlayerId, halfStars: ratings.halfStars })
    .from(ratings)
    .where(and(eq(ratings.roundId, roundId), eq(ratings.raterPlayerId, raterPlayerId)));
  return new Map(rows.map((r) => [r.ratedPlayerId, r.halfStars]));
}

export type EstrelaRecebida = {
  /** Posição na lista ordenada — é por ela que o jogador denuncia. O id real
   *  nunca sai do servidor: sendo serial, entregaria a ordem de envio. */
  indice: number;
  halfStars: number;
  descartada: boolean;
  denunciaStatus: "open" | "accepted" | "rejected" | null;
};

export type RodadaAvaliada = {
  roundId: number;
  matchDayId: number;
  matchDayDate: string;
  skillBefore: number | null;
  skillAfter: number | null;
  podeDenunciar: boolean;
  estrelas: EstrelaRecebida[];
};

/**
 * O que o jogador recebeu em cada rodada já apurada, anonimizado.
 *
 * A ordem vem de ordenarAnonimo (nota desc, desempate por hash) e é estável,
 * então a posição na lista funciona como identificador estável da avaliação
 * sem expor o `ratings.id`.
 */
export async function getEstrelasRecebidas(playerId: number): Promise<RodadaAvaliada[]> {
  const linhas = await db
    .select({
      roundId: ratingRounds.id,
      matchDayId: ratingRounds.matchDayId,
      matchDayDate: matchDays.date,
      ratingId: ratings.id,
      halfStars: ratings.halfStars,
      descartada: sql<boolean>`${ratings.discardedAt} is not null`,
      denunciaStatus: ratingReports.status,
      // Denúncia só vale dentro do prazo e a partir de 2 avaliações recebidas:
      // com uma só, reportar seria apontar o dedo para alguém óbvio.
      dentroDoPrazo: sql<boolean>`${ratingRounds.reportDeadlineAt} > now()`,
    })
    .from(ratings)
    .innerJoin(ratingRounds, eq(ratings.roundId, ratingRounds.id))
    .innerJoin(matchDays, eq(ratingRounds.matchDayId, matchDays.id))
    .leftJoin(ratingReports, eq(ratingReports.ratingId, ratings.id))
    .where(and(eq(ratings.ratedPlayerId, playerId), eq(ratingRounds.status, "closed")))
    .orderBy(desc(matchDays.date), desc(ratingRounds.id));

  const historico = await db
    .select({
      roundId: skillHistory.roundId,
      before: skillHistory.skillBefore,
      after: skillHistory.skillAfter,
    })
    .from(skillHistory)
    .where(eq(skillHistory.playerId, playerId));
  const historicoPorRodada = new Map(historico.map((h) => [h.roundId, h]));

  const porRodada = new Map<number, typeof linhas>();
  for (const linha of linhas) {
    const lista = porRodada.get(linha.roundId);
    if (lista) lista.push(linha);
    else porRodada.set(linha.roundId, [linha]);
  }

  return [...porRodada.values()].map((grupo) => {
    const primeira = grupo[0];
    const h = historicoPorRodada.get(primeira.roundId);
    return {
      roundId: primeira.roundId,
      matchDayId: primeira.matchDayId,
      matchDayDate: primeira.matchDayDate,
      skillBefore: h?.before ?? null,
      skillAfter: h?.after ?? null,
      podeDenunciar: primeira.dentroDoPrazo && grupo.length >= MIN_AVALIACOES_PARA_DENUNCIAR,
      estrelas: ordenarAnonimo(grupo).map((r, indice) => ({
        indice,
        halfStars: r.halfStars,
        descartada: r.descartada,
        denunciaStatus: r.denunciaStatus,
      })),
    };
  });
}

/**
 * Traduz a posição que o jogador vê de volta para o `ratings.id` real,
 * repetindo exatamente a mesma ordenação da tela. É o par de
 * getEstrelasRecebidas: sem isto, a posição não teria como virar ação.
 */
export async function resolverAvaliacaoPorIndice(
  roundId: number,
  ratedPlayerId: number,
  indice: number,
): Promise<number | null> {
  const linhas = await db
    .select({ ratingId: ratings.id, halfStars: ratings.halfStars })
    .from(ratings)
    .where(and(eq(ratings.roundId, roundId), eq(ratings.ratedPlayerId, ratedPlayerId)));

  const ordenadas = ordenarAnonimo(linhas);
  return ordenadas[indice]?.ratingId ?? null;
}

export type AvaliadorDaRodada = {
  playerId: number;
  name: string;
  nickname: string | null;
  jaAvaliou: boolean;
};

/**
 * O roster congelado da rodada, com quem já enviou — a lista que deixa a
 * rapaziada cobrar quem está devendo.
 *
 * Conta desativada depois da abertura sai daqui: é o mesmo filtro `users.active`
 * de fecharSeTodosAvaliaram, então o tamanho da lista é o denominador real do
 * "todos avaliaram" e uma conta desligada não trava a rodada para sempre.
 *
 * A ordem é pendentes primeiro (por nome) e depois quem já avaliou (por nome).
 * Nunca por `submittedAt`: a ordem de envio é informação que o anonimato não
 * entrega — é o mesmo motivo do desempate por hash em anonimato.ts.
 */
export async function getAvaliadoresDaRodada(roundId: number): Promise<AvaliadorDaRodada[]> {
  return db
    .select({
      playerId: ratingRoundRaters.playerId,
      name: players.name,
      nickname: players.nickname,
      jaAvaliou: sql<boolean>`${ratingRoundRaters.submittedAt} is not null`,
    })
    .from(ratingRoundRaters)
    .innerJoin(
      users,
      and(eq(ratingRoundRaters.userId, users.id), eq(users.active, true)),
    )
    .innerJoin(players, eq(ratingRoundRaters.playerId, players.id))
    .where(eq(ratingRoundRaters.roundId, roundId))
    .orderBy(sql`${ratingRoundRaters.submittedAt} is not null`, players.name);
}
