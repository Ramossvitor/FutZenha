import "server-only";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  matchDays,
  players,
  ratingRoundRaters,
  ratingRounds,
  ratings,
  skillHistory,
  users,
} from "@/db/schema";
import { formatSkill } from "./format";
import { notificar } from "./notifications";
import {
  getRatersElegiveis,
  PRAZO_AVALIACAO_DIAS,
  PRAZO_DENUNCIA_DIAS,
  prazoEmDias,
} from "./ratings";
import { notaParaCent, replaySkills, type RatingInput, type SkillChange } from "./skill";

// Aceita o `db` ou o `tx` de dentro de uma transação: o replay roda tanto
// sozinho quanto no meio de um fechamento de rodada.
type Executor = Pick<typeof db, "select" | "insert" | "update" | "delete">;

/**
 * De onde veio o recálculo. Só serve para a chave de deduplicação da
 * notificação, para a mesma pessoa não receber dois avisos do mesmo evento.
 */
export type MotivoReplay = { tipo: "rodada" | "revisao"; dedupeKey: string };

/**
 * Abre a rodada de avaliação de uma pelada encerrada.
 *
 * Idempotente por construção: a unique em `rating_rounds.match_day_id` mais o
 * `onConflictDoNothing` garantem que encerrar a mesma pelada duas vezes não
 * abre duas rodadas nem notifica de novo.
 *
 * Devolve o id da rodada criada, ou null quando não há o que avaliar — pelada
 * sem jogos lançados, sem escalação, ou sem ninguém com conta ativa. Nesses
 * casos a pelada encerra normalmente, só não gera avaliação.
 */
export async function abrirRodada(matchDayId: number): Promise<number | null> {
  const raters = await getRatersElegiveis(matchDayId);
  if (raters.length === 0) return null;

  return db.transaction(async (tx) => {
    const [round] = await tx
      .insert(ratingRounds)
      .values({ matchDayId, deadlineAt: prazoEmDias(PRAZO_AVALIACAO_DIAS) })
      .onConflictDoNothing({ target: ratingRounds.matchDayId })
      .returning();
    // Já existia uma rodada para esta pelada — nada a fazer.
    if (!round) return null;

    await tx.insert(ratingRoundRaters).values(
      raters.map((r) => ({ roundId: round.id, playerId: r.playerId, userId: r.userId })),
    );

    await notificar(
      tx,
      raters.map((r) => ({
        playerId: r.playerId,
        type: "rating_round_open" as const,
        title: "Avalie seus companheiros",
        body: `Você tem ${PRAZO_AVALIACAO_DIAS} dias para avaliar quem jogou com você.`,
        href: `/avaliar/${round.id}`,
        dedupeKey: `rodada:${round.id}:aberta`,
      })),
    );

    return round.id;
  });
}

// Não existe função para descartar rodada: a escalação é confirmada no
// encerramento e nunca mais muda, então a base da avaliação nunca fica
// inválida. O status `cancelled` fica reservado para excluir a pelada por
// votação, que também apaga a rodada dela.

/**
 * Recalcula a nota de todo mundo do zero e grava o resultado.
 *
 * Não aplica delta: lê todas as rodadas apuradas com as avaliações que ainda
 * valem, roda o replay desde 5,0 e regrava. É isso que faz descartar uma
 * avaliação antiga (denúncia aceita) ou apagar uma pelada inteira funcionarem
 * sem nenhum código de desfazimento — a nota é sempre função do que sobrou.
 *
 * Idempotente: rodar duas vezes seguidas escreve os mesmos bytes.
 *
 * `motivo` entra na chave de deduplicação das notificações. Fechar a rodada 12
 * notifica com `nota:rodada:12`; um replay em cascata usa outra chave, para a
 * pessoa não receber a mesma notícia duas vezes nem ficar sem aviso quando a
 * nota mudar de novo.
 */
export async function aplicarReplay(exec: Executor, motivo: MotivoReplay): Promise<SkillChange[]> {
  const rodadas = await exec
    .select({
      roundId: ratingRounds.id,
      matchDayId: ratingRounds.matchDayId,
      matchDayDate: matchDays.date,
    })
    .from(ratingRounds)
    .innerJoin(matchDays, eq(ratingRounds.matchDayId, matchDays.id))
    .where(eq(ratingRounds.status, "closed"))
    // Ordem canônica: data da pelada, nunca data de apuração. A nota é função
    // das avaliações, não de quando o admin clicou.
    .orderBy(asc(matchDays.date), asc(matchDays.id), asc(ratingRounds.id));

  if (rodadas.length === 0) return [];

  const validas = await exec
    .select({
      roundId: ratings.roundId,
      raterPlayerId: ratings.raterPlayerId,
      ratedPlayerId: ratings.ratedPlayerId,
      stars: ratings.stars,
    })
    .from(ratings)
    .where(
      and(
        isNull(ratings.discardedAt),
        inArray(
          ratings.roundId,
          rodadas.map((r) => r.roundId),
        ),
      ),
    );

  const porRodada = new Map<number, RatingInput[]>();
  for (const r of validas) {
    const lista = porRodada.get(r.roundId);
    const item = {
      raterPlayerId: r.raterPlayerId,
      ratedPlayerId: r.ratedPlayerId,
      stars: r.stars,
    };
    if (lista) lista.push(item);
    else porRodada.set(r.roundId, [item]);
  }

  const { skillByPlayer, history } = replaySkills(
    rodadas.map((r) => ({ ...r, ratings: porRodada.get(r.roundId) ?? [] })),
  );

  // Notas atuais para descobrir quem de fato mudou — só quem mudou recebe
  // UPDATE e notificação.
  const atuais = await exec
    .select({ id: players.id, skill: players.skill })
    .from(players)
    .where(
      inArray(players.id, [...skillByPlayer.keys()].length ? [...skillByPlayer.keys()] : [-1]),
    );
  const mudaram = atuais.filter((p) => {
    const nova = skillByPlayer.get(p.id);
    return nova !== undefined && notaParaCent(nova) !== notaParaCent(p.skill);
  });

  // skill_history é projeção do replay: apagar e reescrever é o que garante
  // que não sobre linha de um cálculo anterior.
  await exec.delete(skillHistory);
  if (history.length > 0) {
    await exec.insert(skillHistory).values(
      history.map((h) => ({
        playerId: h.playerId,
        roundId: h.roundId,
        skillBefore: h.before,
        skillAfter: h.after,
        ratingsCount: h.ratingsCount,
        averageReceived: h.averageReceived,
      })),
    );
  }

  for (const p of mudaram) {
    const nova = skillByPlayer.get(p.id)!;
    await exec.update(players).set({ skill: nova }).where(eq(players.id, p.id));
  }

  await notificar(
    exec,
    mudaram.map((p) => {
      const nova = skillByPlayer.get(p.id)!;
      const subiu = nova > p.skill;
      return {
        playerId: p.id,
        type: motivo.tipo === "rodada" ? ("skill_changed" as const) : ("skill_recalculated" as const),
        title: subiu ? "Sua nota subiu!" : "Sua nota mudou",
        body:
          motivo.tipo === "rodada"
            ? `De ${formatSkill(p.skill)} para ${formatSkill(nova)} depois da última pelada.`
            : `De ${formatSkill(p.skill)} para ${formatSkill(nova)} — uma avaliação foi revista.`,
        href: "/perfil",
        dedupeKey: motivo.dedupeKey,
      };
    }),
  );

  return history;
}

/**
 * Fecha a rodada e recalcula as notas.
 *
 * A transição é `UPDATE ... WHERE status = 'open' RETURNING`: se voltar zero
 * linhas, outra execução já fechou e não há nada a fazer. É essa condição, e
 * não o advisory lock, que garante que fechar duas vezes não conta em dobro.
 */
export async function fecharRodada(
  exec: Executor,
  roundId: number,
  motivo: "todos_avaliaram" | "prazo" | "admin",
): Promise<boolean> {
  const fechadas = await exec
    .update(ratingRounds)
    .set({
      status: "closed",
      closedAt: sql`now()`,
      reportDeadlineAt: prazoEmDias(PRAZO_DENUNCIA_DIAS),
      closeReason: motivo,
    })
    .where(and(eq(ratingRounds.id, roundId), eq(ratingRounds.status, "open")))
    .returning({ id: ratingRounds.id });

  if (fechadas.length === 0) return false;

  await aplicarReplay(exec, { tipo: "rodada", dedupeKey: `nota:rodada:${roundId}` });
  return true;
}

/**
 * Fecha a rodada se todo mundo que devia avaliar já avaliou. Chamado depois de
 * cada envio. Conta desativada depois da abertura não trava a rodada.
 */
export async function fecharSeTodosAvaliaram(roundId: number): Promise<boolean> {
  const [pendencia] = await db
    .select({
      pendentes: sql<number>`count(*) filter (
        where ${ratingRoundRaters.submittedAt} is null and ${users.active}
      )::int`,
    })
    .from(ratingRoundRaters)
    .innerJoin(users, eq(ratingRoundRaters.userId, users.id))
    .where(eq(ratingRoundRaters.roundId, roundId));

  if (!pendencia || pendencia.pendentes > 0) return false;
  return db.transaction((tx) => fecharRodada(tx, roundId, "todos_avaliaram"));
}
