import "server-only";
import { and, asc, eq, gt, isNull, lte, sql } from "drizzle-orm";
import { db, type Executor } from "@/db";
import {
  gamePlayers,
  games,
  matchDayDeletionVoters,
  matchDayDeletionVotes,
  matchDays,
  players,
  users,
} from "@/db/schema";
import { formatDate } from "./format";
import { notificar } from "./notifications";
import { prazoEmDias } from "./ratings";
import { aplicarReplay } from "./ratings-engine";
import { avaliarVotacao, placar, PRAZO_VOTACAO_DIAS, votosNecessarios } from "./votacao";

/**
 * Quem vota: jogou a pelada e tem conta ativa. São os afetados — a exclusão
 * apaga os gols, o V/E/D e as avaliações deles.
 */
async function getEleitores(matchDayId: number): Promise<number[]> {
  const linhas = await db
    .selectDistinct({ playerId: gamePlayers.playerId })
    .from(gamePlayers)
    .innerJoin(games, eq(gamePlayers.gameId, games.id))
    .innerJoin(users, and(eq(users.playerId, gamePlayers.playerId), eq(users.active, true)))
    .where(eq(games.matchDayId, matchDayId));
  return linhas.map((l) => l.playerId);
}

export type AberturaVotacao =
  | { tipo: "votacao"; voteId: number; eleitores: number }
  /** Ninguém com conta jogou: não há quem seja afetado, o admin apaga direto. */
  | { tipo: "sem-eleitores" }
  | { tipo: "ja-existe" };

export async function abrirVotacao(
  matchDayId: number,
  reason: string,
): Promise<AberturaVotacao> {
  const eleitores = await getEleitores(matchDayId);
  if (eleitores.length === 0) return { tipo: "sem-eleitores" };

  const [matchDay] = await db.select().from(matchDays).where(eq(matchDays.id, matchDayId));

  return db.transaction(async (tx) => {
    const [votacao] = await tx
      .insert(matchDayDeletionVotes)
      .values({
        matchDayId,
        reason,
        deadlineAt: prazoEmDias(PRAZO_VOTACAO_DIAS),
        eligibleCount: eleitores.length,
        requiredYes: votosNecessarios(eleitores.length),
      })
      // A unique em match_day_id é o que impede uma segunda votação — inclusive
      // depois de uma rejeitada.
      .onConflictDoNothing({ target: matchDayDeletionVotes.matchDayId })
      .returning();
    if (!votacao) return { tipo: "ja-existe" as const };

    await tx
      .insert(matchDayDeletionVoters)
      .values(eleitores.map((playerId) => ({ voteId: votacao.id, playerId })));

    await notificar(
      tx,
      eleitores.map((playerId) => ({
        playerId,
        type: "deletion_vote_open" as const,
        title: "Votação: excluir uma pelada",
        body: `O admin propôs apagar a pelada de ${formatDate(matchDay.date)}. Seu voto é definitivo e não votar conta como contra.`,
        href: `/votacao/${votacao.id}`,
        dedupeKey: `votacao:${votacao.id}:aberta`,
      })),
    );

    return { tipo: "votacao" as const, voteId: votacao.id, eleitores: eleitores.length };
  });
}

export type ResultadoVoto = "registrado" | "ja-votou" | "nao-elegivel" | "encerrada";

export async function registrarVoto(
  voteId: number,
  playerId: number,
  aFavor: boolean,
): Promise<ResultadoVoto> {
  return db.transaction(async (tx) => {
    // O prazo entra no filtro, e não só o status: a votação continua `open` no
    // banco até o varredor passar (visita ao site, no máximo 1×/min, ou o cron
    // diário), então numa semana parada ela fica vencida e aberta por horas.
    // Sem esta condição, um SIM atrasado ainda contaria — e como avaliarVotacao
    // testa o quórum antes do prazo, ele aprovaria a exclusão de uma pelada que
    // já deveria ter sido mantida por silêncio.
    const [votacao] = await tx
      .select()
      .from(matchDayDeletionVotes)
      .where(
        and(
          eq(matchDayDeletionVotes.id, voteId),
          eq(matchDayDeletionVotes.status, "open"),
          gt(matchDayDeletionVotes.deadlineAt, sql`now()`),
        ),
      );
    if (!votacao) return "encerrada";

    // Voto é definitivo: só grava quando ainda está nulo. Zero linhas de volta
    // significa "já votou", sem precisar de coluna extra para marcar isso.
    const [registrado] = await tx
      .update(matchDayDeletionVoters)
      .set({ inFavor: aFavor, votedAt: sql`now()` })
      .where(
        and(
          eq(matchDayDeletionVoters.voteId, voteId),
          eq(matchDayDeletionVoters.playerId, playerId),
          isNull(matchDayDeletionVoters.inFavor),
        ),
      )
      .returning({ playerId: matchDayDeletionVoters.playerId });

    if (!registrado) {
      const [elegivel] = await tx
        .select({ playerId: matchDayDeletionVoters.playerId })
        .from(matchDayDeletionVoters)
        .where(
          and(
            eq(matchDayDeletionVoters.voteId, voteId),
            eq(matchDayDeletionVoters.playerId, playerId),
          ),
        );
      return elegivel ? "ja-votou" : "nao-elegivel";
    }

    await resolverVotacao(tx, voteId);
    return "registrado";
  });
}

async function contarVotos(exec: Executor, voteId: number) {
  const [row] = await exec
    .select({
      sim: sql<number>`count(*) filter (where ${matchDayDeletionVoters.inFavor})::int`,
      nao: sql<number>`count(*) filter (where ${matchDayDeletionVoters.inFavor} = false)::int`,
    })
    .from(matchDayDeletionVoters)
    .where(eq(matchDayDeletionVoters.voteId, voteId));
  return row ?? { sim: 0, nao: 0 };
}

/**
 * Apura a votação e, se aprovada, apaga a pelada.
 *
 * A exclusão leva junto, por cascade, presenças, times, jogos, gols, escalação,
 * a rodada e as avaliações. O replay depois disso recalcula a nota de todo
 * mundo sem aquelas avaliações — em cadeia, como na denúncia aceita.
 */
export async function resolverVotacao(exec: Executor, voteId: number): Promise<boolean> {
  const [votacao] = await exec
    .select({
      id: matchDayDeletionVotes.id,
      matchDayId: matchDayDeletionVotes.matchDayId,
      eligibleCount: matchDayDeletionVotes.eligibleCount,
      matchDayDate: matchDays.date,
      prazoVencido: sql<boolean>`${matchDayDeletionVotes.deadlineAt} <= now()`,
    })
    .from(matchDayDeletionVotes)
    .innerJoin(matchDays, eq(matchDayDeletionVotes.matchDayId, matchDays.id))
    .where(and(eq(matchDayDeletionVotes.id, voteId), eq(matchDayDeletionVotes.status, "open")));
  if (!votacao) return false;

  const { sim, nao } = await contarVotos(exec, voteId);
  const destino = avaliarVotacao({ elegiveis: votacao.eligibleCount, sim, nao }, votacao.prazoVencido);
  if (destino === "open") return false;

  const [resolvida] = await exec
    .update(matchDayDeletionVotes)
    .set({ status: destino, resolvedAt: sql`now()` })
    .where(and(eq(matchDayDeletionVotes.id, voteId), eq(matchDayDeletionVotes.status, "open")))
    .returning({ id: matchDayDeletionVotes.id });
  if (!resolvida) return false;

  const eleitores = await exec
    .select({ playerId: matchDayDeletionVoters.playerId })
    .from(matchDayDeletionVoters)
    .where(eq(matchDayDeletionVoters.voteId, voteId));

  const dataFormatada = formatDate(votacao.matchDayDate);

  // Notifica antes de apagar: o delete leva a votação junto por cascade, e as
  // notificações apontam para o jogador, não para a pelada.
  await notificar(
    exec,
    eleitores.map((e) => ({
      playerId: e.playerId,
      type: "deletion_vote_resolved" as const,
      title: destino === "approved" ? "Pelada excluída pelo grupo" : "Pelada mantida",
      body:
        destino === "approved"
          ? `A pelada de ${dataFormatada} foi apagada: ${sim} de ${votacao.eligibleCount} votaram a favor. As notas foram recalculadas.`
          : `A votação para apagar a pelada de ${dataFormatada} não atingiu os votos necessários. Ela continua no histórico.`,
      href: "/peladas",
      dedupeKey: `votacao:${voteId}:resolvida`,
    })),
  );

  if (destino === "approved") {
    await exec.delete(matchDays).where(eq(matchDays.id, votacao.matchDayId));
    await aplicarReplay(exec, { tipo: "revisao", dedupeKey: `nota:votacao:${voteId}` });
  }

  return true;
}

/** Resolve as votações com prazo vencido. Chamado pelo varredor. */
export async function resolverVotacoesVencidas(exec: Executor): Promise<number> {
  const vencidas = await exec
    .select({ id: matchDayDeletionVotes.id })
    .from(matchDayDeletionVotes)
    .where(
      and(
        eq(matchDayDeletionVotes.status, "open"),
        lte(matchDayDeletionVotes.deadlineAt, sql`now()`),
      ),
    )
    .orderBy(asc(matchDayDeletionVotes.id));

  let resolvidas = 0;
  for (const v of vencidas) {
    if (await resolverVotacao(exec, v.id)) resolvidas += 1;
  }
  return resolvidas;
}

export type VotacaoDetalhe = {
  voteId: number;
  matchDayId: number;
  matchDayDate: string;
  location: string;
  reason: string;
  status: "open" | "approved" | "rejected";
  horasRestantes: number;
  meuVoto: boolean | null;
  jaVotei: boolean;
  placar: ReturnType<typeof placar>;
};

export async function getVotacao(
  voteId: number,
  playerId: number,
): Promise<VotacaoDetalhe | null> {
  const [votacao] = await db
    .select({
      voteId: matchDayDeletionVotes.id,
      matchDayId: matchDayDeletionVotes.matchDayId,
      matchDayDate: matchDays.date,
      location: matchDays.location,
      reason: matchDayDeletionVotes.reason,
      status: matchDayDeletionVotes.status,
      eligibleCount: matchDayDeletionVotes.eligibleCount,
      horasRestantes: sql<number>`greatest(0, ceil(extract(epoch from (
        ${matchDayDeletionVotes.deadlineAt} - now()
      )) / 3600)::int)`,
      meuVoto: matchDayDeletionVoters.inFavor,
    })
    .from(matchDayDeletionVoters)
    .innerJoin(
      matchDayDeletionVotes,
      eq(matchDayDeletionVoters.voteId, matchDayDeletionVotes.id),
    )
    .innerJoin(matchDays, eq(matchDayDeletionVotes.matchDayId, matchDays.id))
    .where(
      and(
        eq(matchDayDeletionVoters.voteId, voteId),
        eq(matchDayDeletionVoters.playerId, playerId),
      ),
    );
  if (!votacao) return null;

  const { sim, nao } = await contarVotos(db, voteId);
  return {
    ...votacao,
    jaVotei: votacao.meuVoto !== null,
    placar: placar(votacao.eligibleCount, sim, nao),
  };
}

export type VotacaoAberta = {
  voteId: number;
  matchDayDate: string;
  horasRestantes: number;
  jaVotei: boolean;
};

/** Votações abertas em que este jogador é eleitor. */
export async function getVotacoesAbertasDoJogador(playerId: number): Promise<VotacaoAberta[]> {
  return db
    .select({
      voteId: matchDayDeletionVotes.id,
      matchDayDate: matchDays.date,
      horasRestantes: sql<number>`greatest(0, ceil(extract(epoch from (
        ${matchDayDeletionVotes.deadlineAt} - now()
      )) / 3600)::int)`,
      jaVotei: sql<boolean>`${matchDayDeletionVoters.inFavor} is not null`,
    })
    .from(matchDayDeletionVoters)
    .innerJoin(
      matchDayDeletionVotes,
      eq(matchDayDeletionVoters.voteId, matchDayDeletionVotes.id),
    )
    .innerJoin(matchDays, eq(matchDayDeletionVotes.matchDayId, matchDays.id))
    .where(
      and(
        eq(matchDayDeletionVoters.playerId, playerId),
        eq(matchDayDeletionVotes.status, "open"),
      ),
    )
    .orderBy(asc(matchDayDeletionVotes.deadlineAt));
}

/** A votação de uma pelada, para o painel do admin. */
export async function getVotacaoDaPelada(matchDayId: number) {
  const [votacao] = await db
    .select({
      id: matchDayDeletionVotes.id,
      reason: matchDayDeletionVotes.reason,
      status: matchDayDeletionVotes.status,
      eligibleCount: matchDayDeletionVotes.eligibleCount,
      requiredYes: matchDayDeletionVotes.requiredYes,
      horasRestantes: sql<number>`greatest(0, ceil(extract(epoch from (
        ${matchDayDeletionVotes.deadlineAt} - now()
      )) / 3600)::int)`,
      sim: sql<number>`(select count(*) filter (where in_favor) from match_day_deletion_voters where vote_id = ${matchDayDeletionVotes.id})::int`,
      nao: sql<number>`(select count(*) filter (where in_favor = false) from match_day_deletion_voters where vote_id = ${matchDayDeletionVotes.id})::int`,
    })
    .from(matchDayDeletionVotes)
    .where(eq(matchDayDeletionVotes.matchDayId, matchDayId));
  return votacao ?? null;
}

/** Nomes de quem ainda não votou, para o admin cobrar. */
export async function getFaltamVotar(voteId: number): Promise<string[]> {
  const linhas = await db
    .select({ name: players.name })
    .from(matchDayDeletionVoters)
    .innerJoin(players, eq(matchDayDeletionVoters.playerId, players.id))
    .where(
      and(eq(matchDayDeletionVoters.voteId, voteId), isNull(matchDayDeletionVoters.inFavor)),
    )
    .orderBy(asc(players.name));
  return linhas.map((l) => l.name);
}
