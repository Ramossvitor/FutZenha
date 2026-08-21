import "server-only";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, type Executor } from "@/db";
import {
  matchDays,
  players,
  ratingRoundRaters,
  ratingRounds,
  ratings,
  skillHistory,
  users,
} from "@/db/schema";
import { apurarMvp } from "./mvp";
import { notificar } from "./notifications";
import {
  getAgregadosMvp,
  getRatersElegiveis,
  prazoEmHoras,
  type RaterElegivel,
} from "./ratings";
import { PRAZO_AVALIACAO_HORAS, PRAZO_DENUNCIA_HORAS } from "./regras";
import { lerMultiplicadoresPorRodada } from "./multiplicador-engine";
import { diffNotas, replaySkills, type RatingInput, type SkillChange } from "./skill";

/**
 * Chave do advisory lock que serializa o recálculo da nota. Fixa e arbitrária.
 * O varredor (src/lib/pendencias.ts) toma a mesma chave: os dois protegem a
 * mesma seção crítica, que é reescrever `skill_history` e `players.skill`.
 */
export const LOCK_NOTA = 918273645;

/**
 * De onde veio o recálculo. Só serve para a chave de deduplicação da
 * notificação, para a mesma pessoa não receber dois avisos do mesmo evento.
 */
export type MotivoReplay = { tipo: "rodada" | "revisao"; dedupeKey: string };

/** A rodada recém-aberta e o eleitorado dela — ver `abrirRodada`. */
export type RodadaAberta = { roundId: number; raters: RaterElegivel[] };

/**
 * Abre a rodada de avaliação de um fut encerrado.
 *
 * Idempotente por construção: a unique em `rating_rounds.match_day_id` mais o
 * `onConflictDoNothing` garantem que encerrar o mesmo fut duas vezes não
 * abre duas rodadas.
 *
 * Devolve a rodada e quem a avalia, ou null quando não há o que avaliar — fut
 * sem jogos lançados, sem escalação, ou sem ninguém com conta ativa. Nesses
 * casos o fut encerra normalmente, só não gera avaliação.
 *
 * **Não notifica.** Notificava, com um `rating_round_open` por avaliador; hoje o
 * aviso do encerramento é UM só por pessoa, com o resumo do fut junto, e quem o
 * monta é `notificarEncerramento` (./encerramento-avisos). Dois avisos no mesmo
 * segundo competiam pela mesma atenção, e o segundo — "avalie" — chegava antes
 * de a pessoa saber como o jogo terminou.
 *
 * Devolve os raters em vez de deixar quem chama reconsultá-los porque
 * `getRatersElegiveis` já rodou aqui dentro, na mesma transação: repetir a
 * consulta seria uma segunda definição de "quem avalia", pronta para divergir
 * da que congelou o eleitorado.
 *
 * Recebe o executor em vez de abrir a própria transação para que encerrar a
 * fut e abrir a rodada sejam o mesmo commit: encerrar sem rodada seria um
 * beco sem saída, já que não existe "reabrir fut".
 */
export async function abrirRodada(
  exec: Executor,
  matchDayId: number,
): Promise<RodadaAberta | null> {
  // No MESMO executor da transação — com o `db` global aqui, a query ficava na
  // fila esperando a conexão que a própria transação segurava (deadlock).
  const raters = await getRatersElegiveis(exec, matchDayId);
  if (raters.length === 0) return null;

  const [round] = await exec
    .insert(ratingRounds)
    .values({ matchDayId, deadlineAt: prazoEmHoras(PRAZO_AVALIACAO_HORAS) })
    .onConflictDoNothing({ target: ratingRounds.matchDayId })
    .returning();
  // Já existia uma rodada para este fut — nada a fazer.
  if (!round) return null;

  await exec.insert(ratingRoundRaters).values(
    raters.map((r) => ({ roundId: round.id, playerId: r.playerId, userId: r.userId })),
  );

  return { roundId: round.id, raters };
}

// Não existe função para descartar rodada: a escalação é confirmada no
// encerramento e nunca mais muda, então a base da avaliação nunca fica
// inválida. O status `cancelled` fica reservado para excluir o fut por
// votação, que também apaga a rodada dela.

/**
 * Recalcula a nota de todo mundo do zero e grava o resultado.
 *
 * Não aplica delta: lê todas as rodadas apuradas com as avaliações que ainda
 * valem, roda o replay desde 5,0 e regrava. É isso que faz descartar uma
 * avaliação antiga (denúncia aceita) ou apagar um fut inteiro funcionarem
 * sem nenhum código de desfazimento — a nota é sempre função do que sobrou.
 *
 * Idempotente: rodar duas vezes seguidas escreve os mesmos bytes.
 *
 * `motivo` entra na chave de deduplicação das notificações. Fechar a rodada 12
 * notifica com `nota:rodada:12`; um replay em cascata usa outra chave, para a
 * pessoa não receber a mesma notícia duas vezes nem ficar sem aviso quando a
 * nota mudar de novo.
 *
 * Toma o advisory lock antes de qualquer leitura porque `skill_history` é
 * reescrita inteira (delete + insert): dois replays concorrentes colidiriam na
 * unique (player_id, round_id), e o mais brando dos entrelaçamentos seria uma
 * nota calculada sem a rodada que o outro acabou de fechar. Aqui o lock é
 * bloqueante, ao contrário do `try_` do varredor: lá desistir é seguro, porque
 * o trabalho é retentado no próximo request; aqui desistir seria devolver nota
 * errada. Chamar com o `db` cru em vez de um `tx` não travaria nada — todos os
 * caminhos que chegam aqui abrem transação.
 */
export async function aplicarReplay(exec: Executor, motivo: MotivoReplay): Promise<SkillChange[]> {
  await exec.execute(sql`select pg_advisory_xact_lock(${LOCK_NOTA}::bigint)`);

  const rodadas = await exec
    .select({
      roundId: ratingRounds.id,
      matchDayId: ratingRounds.matchDayId,
      matchDayDate: matchDays.date,
      legacyScale: ratingRounds.legacyScale,
    })
    .from(ratingRounds)
    .innerJoin(matchDays, eq(ratingRounds.matchDayId, matchDays.id))
    .where(eq(ratingRounds.status, "closed"))
    // Ordem canônica: data do fut, nunca data de apuração. A nota é função
    // das avaliações, não de quando o admin clicou.
    .orderBy(asc(matchDays.date), asc(matchDays.id), asc(ratingRounds.id));

  // Sem early-return para zero rodadas: nesse caso o certo é justamente
  // apagar skill_history e devolver todo mundo para 5,0, que é o que o resto
  // desta função faz. Sair aqui deixaria o último fut apagado valendo.
  const validas = await exec
    .select({
      roundId: ratings.roundId,
      raterPlayerId: ratings.raterPlayerId,
      ratedPlayerId: ratings.ratedPlayerId,
      halfStars: ratings.halfStars,
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
      halfStars: r.halfStars,
    };
    if (lista) lista.push(item);
    else porRodada.set(r.roundId, [item]);
  }

  // Os multiplicadores entram como INSUMO do replay, e não como efeito já
  // aplicado. O replay reconstrói a nota desde 5,0 a cada denúncia aceita e a
  // cada fut apagado; reconstruir uma rodada antiga exige o fator que valia
  // nela — que vem congelado de `zenha_multiplicadores`, nunca do ajuste atual.
  // Continua sendo só nota aqui: dinheiro não entra em aplicarReplay.
  const multiplicadores = await lerMultiplicadoresPorRodada(
    exec,
    rodadas.map((r) => r.roundId),
  );

  const { skillByPlayer, history } = replaySkills(
    rodadas.map((r) => ({
      ...r,
      ratings: porRodada.get(r.roundId) ?? [],
      multiplicadores: multiplicadores.get(r.roundId),
    })),
  );

  // Notas atuais para descobrir quem de fato mudou — só quem mudou recebe
  // UPDATE e notificação.
  //
  // Lê todo mundo, e não só quem aparece no replay: quem ficou sem nenhuma
  // avaliação válida também mudou — voltou para 5,0. Quem decide isso é
  // diffNotas(), que é puro e está coberto por teste.
  const atuais = await exec.select({ id: players.id, skill: players.skill }).from(players);
  const mudaram = diffNotas(atuais, skillByPlayer);

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
        multiplicado: h.multiplicado,
      })),
    );
  }

  for (const p of mudaram) {
    await exec.update(players).set({ skill: p.depois }).where(eq(players.id, p.id));
  }

  // O aviso dá a direção, nunca o número: saber quanto ficou é o que faz a
  // pessoa abrir o app. Por isso o corpo só explica de onde veio o recálculo e
  // o href leva ao perfil, onde a nota está em destaque. Vale para o push
  // também — é o mesmo title/body que sai em src/lib/push-envio.ts.
  const corpo =
    motivo.tipo === "rodada"
      ? "Depois do último fut. Toque para ver quanto ficou."
      : "Uma avaliação foi revista. Toque para ver quanto ficou.";

  await notificar(
    exec,
    mudaram.map((p) => ({
      playerId: p.id,
      type: motivo.tipo === "rodada" ? ("skill_changed" as const) : ("skill_recalculated" as const),
      // `mudaram` só traz quem mudou de fato (diffNotas), então não subir é
      // sempre baixar — não existe terceiro caso a cobrir.
      title: p.depois > p.antes ? "Sua nota subiu!" : "Sua nota baixou",
      body: corpo,
      href: "/perfil",
      dedupeKey: motivo.dedupeKey,
    })),
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
      reportDeadlineAt: prazoEmHoras(PRAZO_DENUNCIA_HORAS),
      closeReason: motivo,
    })
    .where(and(eq(ratingRounds.id, roundId), eq(ratingRounds.status, "open")))
    .returning({ id: ratingRounds.id, matchDayId: ratingRounds.matchDayId });

  if (fechadas.length === 0) return false;

  await aplicarReplay(exec, { tipo: "rodada", dedupeKey: `nota:rodada:${roundId}` });

  // A apuração do MVP sai no mesmo commit do fechamento, para os três motivos
  // — no prazo vencido vale o que foi votado, e zero votos é fut sem MVP. O
  // aviso não se repete: a transição de status acima só acontece uma vez, e o
  // dedupeKey segura qualquer reprocessamento.
  const vencedores = apurarMvp(await getAgregadosMvp(exec, roundId));
  await notificar(
    exec,
    vencedores.map((playerId) => ({
      playerId,
      type: "mvp_do_fut" as const,
      title: "Você foi eleito o melhor em campo!",
      body:
        vencedores.length > 1
          ? "Título dividido — empate na votação até na média de estrelas."
          : "A rapaziada votou em você como o MVP do fut.",
      href: `/fut/${fechadas[0].matchDayId}`,
      dedupeKey: `mvp:rodada:${roundId}`,
    })),
  );
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
