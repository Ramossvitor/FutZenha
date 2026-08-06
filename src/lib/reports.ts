import "server-only";
import { and, asc, eq, lte, sql } from "drizzle-orm";
import { db, type Executor } from "@/db";
import {
  gamePlayers,
  games,
  matchDays,
  ratingReports,
  ratingRounds,
  ratings,
} from "@/db/schema";
import { notificar } from "./notifications";
import { aplicarReplay } from "./ratings-engine";

/**
 * O julgador jogou a pelada de onde saiu esta rodada?
 *
 * O admin da plataforma é jogador como qualquer outro (ver src/db/schema.ts), e
 * isso o põe em conflito sempre que a denúncia nasce de uma pelada que ele
 * jogou: julgaria a própria rodada e, pior, leria em `raterName` o nome de quem
 * lhe deu cada estrela — inclusive denunciando uma nota própria só para abrir a
 * lista. É o mesmo motivo que tira o admin da pelada do julgamento (ver
 * README § Nota injusta); a diferença é que ali o impedimento é estrutural e
 * aqui precisa ser consultado.
 */
const jogouNaRodada = (playerId: number) => sql<boolean>`exists (
  select 1 from ${gamePlayers}
    join ${games} on ${games.id} = ${gamePlayers.gameId}
   where ${games.matchDayId} = ${ratingRounds.matchDayId}
     and ${gamePlayers.playerId} = ${playerId}
)`;

/** Quem resolveu: o admin da plataforma, com nome, ou o varredor de prazos. */
export type Julgador = { tipo: "admin"; playerId: number } | { tipo: "auto" };

/**
 * Resolve uma denúncia e, se aceita, descarta a avaliação e recalcula tudo.
 *
 * `{ tipo: "auto" }` é o auto-aceite: o admin deixou o prazo vencer, e o
 * silêncio vale como aceite (decisão do produto — o jogador não pode ficar
 * refém da inércia de quem julga).
 *
 * Sem guard de propósito: quem autoriza é a action (`requirePlatformAdmin`).
 * Este módulo também roda a partir de `processarPendencias()`, que é disparado
 * pelo `after()` do layout e pelo cron, os dois sem sessão nenhuma — um
 * `require*` aqui dentro quebraria o varredor em silêncio.
 *
 * A transição é `UPDATE ... WHERE status = 'open' RETURNING`: zero linhas
 * significa que outra execução já resolveu, e nada acontece de novo.
 */
export async function resolverDenuncia(
  exec: Executor,
  reportId: number,
  aceita: boolean,
  por: Julgador,
  adminNote?: string,
): Promise<boolean> {
  const [resolvida] = await exec
    .update(ratingReports)
    .set({
      status: aceita ? "accepted" : "rejected",
      resolvedAt: sql`now()`,
      resolvedBy: por.tipo,
      resolvedByPlayerId: por.tipo === "admin" ? por.playerId : null,
      adminNote: adminNote?.trim() || null,
    })
    .where(and(eq(ratingReports.id, reportId), eq(ratingReports.status, "open")))
    .returning({ ratingId: ratingReports.ratingId, reporterPlayerId: ratingReports.reporterPlayerId });

  if (!resolvida) return false;

  if (aceita) {
    // Descartar não apaga: a avaliação fica no banco marcada, e o replay
    // simplesmente deixa de contá-la.
    await exec
      .update(ratings)
      .set({ discardedAt: sql`now()` })
      .where(eq(ratings.id, resolvida.ratingId));

    await aplicarReplay(exec, { tipo: "revisao", dedupeKey: `nota:denuncia:${reportId}` });
  }

  await notificar(exec, [
    {
      playerId: resolvida.reporterPlayerId,
      type: "rating_report_resolved",
      title: aceita ? "Sua denúncia foi aceita" : "Sua denúncia foi recusada",
      body: aceita
        ? por.tipo === "admin"
          ? "O admin descartou a nota, e as notas foram recalculadas."
          : "O admin não respondeu no prazo, então a nota foi descartada automaticamente."
        : "O admin analisou e considerou a nota justa. Ela continua valendo.",
      href: "/perfil",
      dedupeKey: `denuncia:${reportId}:resolvida`,
    },
  ]);

  return true;
}

/**
 * Auto-aceita as denúncias cujo prazo do admin venceu. Chamado pelo varredor.
 */
export async function resolverDenunciasVencidas(exec: Executor): Promise<number> {
  const vencidas = await exec
    .select({ id: ratingReports.id })
    .from(ratingReports)
    .where(and(eq(ratingReports.status, "open"), lte(ratingReports.adminDeadlineAt, sql`now()`)))
    .orderBy(asc(ratingReports.id));

  let aceitas = 0;
  for (const denuncia of vencidas) {
    if (await resolverDenuncia(exec, denuncia.id, true, { tipo: "auto" })) aceitas += 1;
  }
  return aceitas;
}

export type DenunciaNaFila = {
  reportId: number;
  ratingId: number;
  reason: string | null;
  reporterName: string;
  reporterPlayerId: number;
  roundId: number;
  matchDayId: number;
  matchDayDate: string;
  starsDenunciada: number;
  horasParaResponder: number;
  /**
   * Quem deu a nota reclamada — `null` quando o julgador jogou a rodada.
   *
   * O anonimato é entre jogadores. Quem julga precisa saber de quem partiu a
   * nota, e pode saber enquanto for alguém de fora daquela pelada; para o
   * julgador impedido o campo não existe, e a tela cai na forma anônima.
   */
  raterName: string | null;
  /** Falso quando o julgador jogou a rodada: a fila mostra, mas não deixa agir. */
  podeJulgar: boolean;
};

/**
 * Denúncias abertas, da mais urgente para a menos.
 *
 * Recebe quem está olhando porque a resposta depende disso: o julgador que
 * jogou a rodada vê a denúncia (para saber que ela existe e que o prazo corre)
 * sem os nomes e sem os botões.
 */
export async function getDenunciasAbertas(julgadorPlayerId: number): Promise<DenunciaNaFila[]> {
  const linhas = await db
    .select({
      reportId: ratingReports.id,
      ratingId: ratingReports.ratingId,
      reason: ratingReports.reason,
      reporterPlayerId: ratingReports.reporterPlayerId,
      roundId: ratingRounds.id,
      matchDayId: ratingRounds.matchDayId,
      matchDayDate: matchDays.date,
      starsDenunciada: ratings.stars,
      horasParaResponder: sql<number>`greatest(0, ceil(extract(epoch from (
        ${ratingReports.adminDeadlineAt} - now()
      )) / 3600)::int)`,
      reporterName: sql<string>`(select name from players where id = ${ratingReports.reporterPlayerId})`,
      raterName: sql<string>`(select name from players where id = ${ratings.raterPlayerId})`,
      impedido: jogouNaRodada(julgadorPlayerId),
    })
    .from(ratingReports)
    .innerJoin(ratings, eq(ratingReports.ratingId, ratings.id))
    .innerJoin(ratingRounds, eq(ratings.roundId, ratingRounds.id))
    .innerJoin(matchDays, eq(ratingRounds.matchDayId, matchDays.id))
    .where(eq(ratingReports.status, "open"))
    .orderBy(asc(ratingReports.adminDeadlineAt));

  return linhas.map(({ impedido, raterName, ...linha }) => ({
    ...linha,
    raterName: impedido ? null : raterName,
    podeJulgar: !impedido,
  }));
}

/**
 * Se este julgador pode decidir esta denúncia. Consultado pelas actions antes
 * de mutar — a fila já esconde os botões, mas Server Action é endpoint público
 * (ver node_modules/next/dist/docs/01-app/02-guides/data-security.md).
 */
export async function julgadorImpedido(
  reportId: number,
  julgadorPlayerId: number,
): Promise<boolean> {
  const [row] = await db
    .select({ impedido: jogouNaRodada(julgadorPlayerId) })
    .from(ratingReports)
    .innerJoin(ratings, eq(ratingReports.ratingId, ratings.id))
    .innerJoin(ratingRounds, eq(ratings.roundId, ratingRounds.id))
    .where(eq(ratingReports.id, reportId));
  // Denúncia inexistente cai como impedida: nada a decidir de qualquer forma.
  return row?.impedido ?? true;
}

export type EstrelaNoContexto = {
  stars: number;
  descartada: boolean;
  /** Esta é a nota que foi reportada. */
  reclamada: boolean;
  /** Quem deu — `null` quando o julgador jogou a rodada (ver `jogouNaRodada`). */
  raterName: string | null;
};

/**
 * Todas as notas que o jogador recebeu na rodada, para o admin decidir com
 * contexto.
 *
 * O `ratings.id` fica no servidor: ele é serial, e a tela lista as notas
 * ordenadas por estrelas — devolver o id entregaria a ordem de envio junto,
 * inclusive no payload RSC, onde ele viajaria como `key` de cada item. Por isso
 * quem sabe qual foi a nota reclamada é esta função, que já recebe o id, e não
 * a página comparando ids.
 */
export async function getContextoDaDenuncia(
  roundId: number,
  playerId: number,
  ratingIdDenunciado: number,
  julgadorPlayerId: number,
): Promise<EstrelaNoContexto[]> {
  const [rodada] = await db
    .select({ impedido: jogouNaRodada(julgadorPlayerId) })
    .from(ratingRounds)
    .where(eq(ratingRounds.id, roundId));
  const impedido = rodada?.impedido ?? true;

  const linhas = await db
    .select({
      ratingId: ratings.id,
      stars: ratings.stars,
      descartada: sql<boolean>`${ratings.discardedAt} is not null`,
      raterName: sql<string>`(select name from players where id = ${ratings.raterPlayerId})`,
    })
    .from(ratings)
    .where(and(eq(ratings.roundId, roundId), eq(ratings.ratedPlayerId, playerId)))
    .orderBy(asc(ratings.stars));

  return linhas.map(({ ratingId, raterName, ...linha }) => ({
    ...linha,
    raterName: impedido ? null : raterName,
    reclamada: ratingId === ratingIdDenunciado,
  }));
}

/**
 * Denúncias ainda não resolvidas — usado no contador do painel. Inclui as de
 * prazo vencido de propósito: elas continuam pendentes até o varredor passar, e
 * são justamente as que o admin ainda tem chance de responder antes do
 * auto-aceite. `status = 'open'` já implica `resolved_at is null`: os dois são
 * escritos no mesmo UPDATE em resolverDenuncia().
 */
export async function contarDenunciasAbertas(): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(ratingReports)
    .where(eq(ratingReports.status, "open"));
  return row?.total ?? 0;
}
