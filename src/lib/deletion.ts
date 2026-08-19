import "server-only";
import { and, asc, eq, gt, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type Executor } from "@/db";
import {
  gamePlayers,
  games,
  matchDayDeletionVoters,
  matchDayDeletionVotes,
  matchDays,
  players,
  ratingRounds,
  users,
} from "@/db/schema";
import { formatDate } from "./format";
import { notificar } from "./notifications";
import { prazoEmHoras } from "./ratings";
import { PRAZO_AVALIACAO_HORAS, PRAZO_DENUNCIA_HORAS } from "./regras";
import { aplicarReplay } from "./ratings-engine";
import {
  avaliarVotacao,
  placar,
  PRAZO_ABERTURA_EXCLUSAO_HORAS,
  PRAZO_VOTACAO_HORAS,
  votosNecessarios,
  type PlacarVotacao,
} from "./votacao";

/**
 * Quem vota: jogou o fut e tem conta ativa. São os afetados — a exclusão
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

/**
 * A justificativa escrita para apagar um fut.
 *
 * Mora aqui, e não em cada action, porque os dois caminhos de exclusão pedem a
 * mesma coisa: o admin do fut ao abrir a votação e o admin da plataforma ao
 * apagar por abuso. Duplicar deixaria os limites divergirem na primeira mudança
 * — foi o mesmo motivo que tirou o schema do formulário de fut de dentro das
 * actions (ver src/lib/match-day-form.ts).
 */
export const motivoExclusaoSchema = z.string().trim().min(10, "Explique o motivo").max(500);

export type AberturaVotacao =
  | { tipo: "votacao"; voteId: number; eleitores: number }
  /** Ninguém com conta jogou: não há quem seja afetado, o admin apaga direto. */
  | { tipo: "sem-eleitores" }
  | { tipo: "ja-existe" }
  /** A janela de abertura fechou: o fut fica no histórico. */
  | { tipo: "prazo-encerrado" };

export type JanelaExclusao = {
  aberta: boolean;
  /** null = o relógio ainda nem começou (rodada de avaliação sem apuração). */
  horasRestantes: number | null;
};

/**
 * Pedir a exclusão tem hora para acontecer: até PRAZO_ABERTURA_EXCLUSAO_HORAS
 * depois do fim do prazo de contestação das notas. Enquanto a rodada de
 * avaliação corre, o relógio nem começou — a trava só arma quando a apuração
 * grava o reportDeadlineAt. Fut sem rodada (não houve grupo mínimo para
 * avaliar) ganha a janela equivalente a contar do encerramento: o que o fluxo
 * normal somaria se a rodada corresse o prazo inteiro. Fut encerrado sem
 * finishedAt (dado legado) fica sem marco temporal — janela fechada, mesmo
 * precedente da JANELA_CORRECAO de placar; o admin da plataforma segue podendo
 * apagar pelo painel.
 */
export async function getJanelaAberturaExclusao(
  exec: Executor,
  matchDayId: number,
): Promise<JanelaExclusao> {
  const janelaSemRodadaHoras =
    PRAZO_AVALIACAO_HORAS + PRAZO_DENUNCIA_HORAS + PRAZO_ABERTURA_EXCLUSAO_HORAS;
  const limite = sql`case
    when ${ratingRounds.id} is not null then
      case
        when ${ratingRounds.status} = 'open' or ${ratingRounds.reportDeadlineAt} is null
          then null
        else ${ratingRounds.reportDeadlineAt}
          + make_interval(hours => ${PRAZO_ABERTURA_EXCLUSAO_HORAS}::int)
      end
    else ${matchDays.finishedAt} + make_interval(hours => ${janelaSemRodadaHoras}::int)
  end`;

  const [linha] = await exec
    .select({
      aberta: sql<boolean>`case
        when ${ratingRounds.id} is not null then
          ${ratingRounds.status} = 'open'
          or ${ratingRounds.reportDeadlineAt} is null
          or ${limite} > now()
        else ${matchDays.finishedAt} is not null and ${limite} > now()
      end`,
      horasRestantes: sql<number | null>`case
        when ${limite} is null then null
        else greatest(0, ceil(extract(epoch from (${limite} - now())) / 3600)::int)
      end`,
    })
    .from(matchDays)
    .leftJoin(ratingRounds, eq(ratingRounds.matchDayId, matchDays.id))
    .where(eq(matchDays.id, matchDayId));

  if (!linha) return { aberta: false, horasRestantes: null };
  return { aberta: linha.aberta, horasRestantes: linha.horasRestantes };
}

// Autorização não mora aqui: quem chama é a action, que já passou pelo
// requireFutAdmin. Este módulo também roda a partir do varredor de prazos
// (src/lib/pendencias.ts), que não tem sessão nenhuma.
export async function abrirVotacao(
  matchDayId: number,
  reason: string,
  openedByPlayerId: number,
): Promise<AberturaVotacao> {
  // Antes de tudo — inclusive do atalho sem-eleitores, que apaga direto na
  // action: janela vencida fecha os dois caminhos de pedido de exclusão.
  const janela = await getJanelaAberturaExclusao(db, matchDayId);
  if (!janela.aberta) return { tipo: "prazo-encerrado" };

  const eleitores = await getEleitores(matchDayId);
  if (eleitores.length === 0) return { tipo: "sem-eleitores" };

  const [matchDay] = await db.select().from(matchDays).where(eq(matchDays.id, matchDayId));
  const [proponente] = await db
    .select({ name: players.name, nickname: players.nickname })
    .from(players)
    .where(eq(players.id, openedByPlayerId));
  const quemPropos = proponente?.nickname ?? proponente?.name ?? "O organizador";

  return db.transaction(async (tx) => {
    const [votacao] = await tx
      .insert(matchDayDeletionVotes)
      .values({
        matchDayId,
        reason,
        openedByPlayerId,
        deadlineAt: prazoEmHoras(PRAZO_VOTACAO_HORAS),
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
        title: "Votação: excluir um fut",
        body: `${quemPropos} propôs apagar o fut de ${formatDate(matchDay.date)}. Seu voto é definitivo e não votar conta como contra.`,
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
    // testa o quórum antes do prazo, ele aprovaria a exclusão de um fut que
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
 * Apura a votação e, se aprovada, apaga o fut.
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
  // notificações apontam para o jogador, não para o fut.
  await notificar(
    exec,
    eleitores.map((e) => ({
      playerId: e.playerId,
      type: "deletion_vote_resolved" as const,
      title: destino === "approved" ? "Fut excluído pelo grupo" : "Fut mantido",
      body:
        destino === "approved"
          ? `O fut de ${dataFormatada} foi apagado: ${sim} de ${votacao.eligibleCount} votaram a favor. As notas foram recalculadas.`
          : `A votação para apagar o fut de ${dataFormatada} não atingiu os votos necessários. Ela continua no histórico.`,
      href: "/futs",
      dedupeKey: `votacao:${voteId}:resolvida`,
    })),
  );

  if (destino === "approved") {
    await apagarFut(exec, votacao.matchDayId, `nota:votacao:${voteId}`);
  }

  return true;
}

/**
 * Apaga o fut e recalcula a nota de todo mundo no mesmo commit.
 *
 * O delete leva rodada e avaliações por cascade, então o replay tem que rodar
 * junto: sem ele, a nota de cada jogador continuaria carregando a contribuição
 * de um fut que não existe mais — e como o replay é sempre do zero, não há
 * código de desfazimento para consertar depois.
 *
 * Sem guard de propósito: quem autoriza é a action que chama (votação
 * aprovada, admin do fut ou admin da plataforma). Este módulo também roda a
 * partir do varredor de prazos, que não tem sessão.
 */
export async function apagarFut(
  exec: Executor,
  matchDayId: number,
  dedupeKey: string,
): Promise<void> {
  await exec.delete(matchDays).where(eq(matchDays.id, matchDayId));
  await aplicarReplay(exec, { tipo: "revisao", dedupeKey });
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
  reason: string;
  horasRestantes: number;
  jaVotei: boolean;
  placar: PlacarVotacao;
};

/**
 * Votações abertas em que este jogador é eleitor.
 *
 * O `from` é `matchDayDeletionVoters` filtrado pelo playerId, e é isso que
 * mantém a privacidade: só quem tem linha de eleitor recebe resultado, que é
 * exatamente o mesmo público que `getVotacao` já autoriza a ver o placar. Quem
 * propôs a votação mas não jogou continua sem enxergar nada. Trocar este `from`
 * por `matchDayDeletionVotes` abriria o placar para qualquer um.
 */
export async function getVotacoesAbertasDoJogador(playerId: number): Promise<VotacaoAberta[]> {
  const linhas = await db
    .select({
      voteId: matchDayDeletionVotes.id,
      matchDayDate: matchDays.date,
      reason: matchDayDeletionVotes.reason,
      eligibleCount: matchDayDeletionVotes.eligibleCount,
      horasRestantes: sql<number>`greatest(0, ceil(extract(epoch from (
        ${matchDayDeletionVotes.deadlineAt} - now()
      )) / 3600)::int)`,
      jaVotei: sql<boolean>`${matchDayDeletionVoters.inFavor} is not null`,
      sim: sql<number>`(select count(*) filter (where in_favor) from match_day_deletion_voters where vote_id = ${matchDayDeletionVotes.id})::int`,
      nao: sql<number>`(select count(*) filter (where in_favor = false) from match_day_deletion_voters where vote_id = ${matchDayDeletionVotes.id})::int`,
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

  return linhas.map(({ eligibleCount, sim, nao, ...resto }) => ({
    ...resto,
    placar: placar(eligibleCount, sim, nao),
  }));
}

/**
 * A votação de um fut, para o painel de quem gerencia.
 *
 * União discriminada de propósito: enquanto a votação está aberta, `sim` e
 * `nao` **não existem no tipo**.
 *
 * O motivo é que o placar parcial desanonimiza. Quem gerencia atualiza a página
 * duas vezes, vê o contador andar de 4 para 5 e sabe exatamente como votou a
 * pessoa que entrou no meio — num voto que a regra promete definitivo e
 * secreto. Deixar os campos existirem e confiar num `status === "open"` dentro
 * do JSX é frágil: qualquer refactor futuro reintroduz o vazamento sem que
 * nada acuse. Do jeito que está, o compilador não deixa.
 *
 * Aberta, o painel mostra só quantos faltam votar (`getFaltamVotar().length`).
 */
export type VotacaoDoFut =
  | {
      status: "open";
      id: number;
      reason: string;
      eligibleCount: number;
      requiredYes: number;
      horasRestantes: number;
    }
  | {
      status: "approved" | "rejected";
      id: number;
      reason: string;
      eligibleCount: number;
      requiredYes: number;
      horasRestantes: number;
      sim: number;
      nao: number;
    };

export async function getVotacaoDoFut(matchDayId: number): Promise<VotacaoDoFut | null> {
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
  if (!votacao) return null;

  const { sim, nao, status, ...comum } = votacao;
  // O descarte é aqui, no servidor. O placar de uma votação aberta nem chega
  // a sair desta função.
  if (status === "open") return { ...comum, status };
  return { ...comum, status, sim, nao };
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
