"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, isNotNull, isNull, notExists, sql } from "drizzle-orm";
import { db, type Executor } from "@/db";
import { attendances, gamePlayers, games, matchDays } from "@/db/schema";
import { formatDate } from "@/lib/format";
import { revalidateMatchDay } from "../../revalidate";
import { notificar } from "@/lib/notifications";
import { avaliarMarcacao, entrarNaLista, mereceAviso, travarFut } from "@/lib/presenca";
import { abrirRodada } from "@/lib/ratings-engine";
import { requireFutAdmin } from "@/lib/require-fut-admin";

// A escalação só é editável enquanto o fut não foi encerrado. Depois da
// confirmação ela é imutável — é ela que define quem avalia quem, e mexer
// nela invalidaria avaliações já enviadas.
async function assertEditavel(matchDayId: number, gameId: number) {
  const [row] = await db
    .select({ status: matchDays.status })
    .from(games)
    .innerJoin(matchDays, eq(games.matchDayId, matchDays.id))
    .where(and(eq(games.id, gameId), eq(games.matchDayId, matchDayId)));

  if (!row) redirect(`/fut/${matchDayId}/gerenciar?erro=dados-invalidos`);
  if (row.status === "finished") {
    redirect(`/fut/${matchDayId}/gerenciar?erro=escalacao-travada`);
  }
}

function revalidar(matchDayId: number) {
  // A tela de encerramento é a única que só existe aqui; o resto do fut sai da
  // lista compartilhada (../../revalidate), que inclui a súmula ao vivo.
  revalidatePath(`/fut/${matchDayId}/gerenciar/encerrar`);
  revalidateMatchDay(matchDayId);
}

export async function moverLado(matchDayId: number, gameId: number, playerId: number) {
  await requireFutAdmin(matchDayId);
  await assertEditavel(matchDayId, gameId);

  await db
    .update(gamePlayers)
    .set({ side: sql`case when ${gamePlayers.side} = 'A' then 'B'::game_side else 'A'::game_side end` })
    .where(and(eq(gamePlayers.gameId, gameId), eq(gamePlayers.playerId, playerId)));
  revalidar(matchDayId);
}

// Tirar do jogo não tira a presença: dá para ter ido ao fut e não ter jogado
// aquela partida.
export async function removerDoJogo(matchDayId: number, gameId: number, playerId: number) {
  await requireFutAdmin(matchDayId);
  await assertEditavel(matchDayId, gameId);

  await db
    .delete(gamePlayers)
    .where(and(eq(gamePlayers.gameId, gameId), eq(gamePlayers.playerId, playerId)));
  revalidar(matchDayId);
}

// Escalar já marca a presença: quem apareceu na quadra sem confirmar é
// justamente o erro que esta tela existe para consertar.
export async function incluirNoJogo(
  matchDayId: number,
  gameId: number,
  side: "A" | "B",
  playerId: number,
) {
  const { session, matchDay } = await requireFutAdmin(matchDayId);
  // A mesma guarda das actions irmãs: id não-inteiro (ou lado inventado) morre
  // aqui com o banner, e não como erro cru do banco no meio da transação.
  if (!Number.isInteger(gameId) || !Number.isInteger(playerId) || (side !== "A" && side !== "B")) {
    redirect(`/fut/${matchDayId}/gerenciar/encerrar?erro=dados-invalidos`);
  }
  await assertEditavel(matchDayId, gameId);
  // Escalar marca presença junto, então vale o mesmo limite do definirPresenca:
  // quem tem conta ativa e nunca entrou neste fut só é escalado por outro se
  // for elegível — e aqui a lista está sempre fechada, porque já existe jogo.
  const { permitido, alvo } = await avaliarMarcacao(session, matchDay, playerId);
  if (!permitido) {
    redirect(`/fut/${matchDayId}/gerenciar/encerrar?erro=precisa-confirmar`);
  }
  const avisar = mereceAviso(session, playerId, alvo);

  await db.transaction(async (tx) => {
    await tx
      .insert(gamePlayers)
      .values({ gameId, playerId, side })
      .onConflictDoUpdate({
        target: [gamePlayers.gameId, gamePlayers.playerId],
        set: { side },
      });
    // Entrar pela lista, e não por upsert cru: quem foi marcado como falta e
    // depois apareceu na escalação tem que voltar a contar presença, e é o
    // entrarNaLista que sabe disso.
    await entrarNaLista(tx, matchDay.id, playerId);

    if (avisar) {
      await notificar(tx, [
        {
          playerId,
          type: "pelada_presenca_definida",
          title: "Marcaram sua presença num fut",
          body: `${session.player.name} escalou você no fut de ${formatDate(matchDay.date)}, em ${matchDay.location}.`,
          href: `/fut/${matchDayId}`,
          dedupeKey: `presenca:${matchDayId}:${playerId}`,
        },
      ]);
    }
  });
  revalidar(matchDayId);
}

/**
 * Quem confirmou e não entrou em nenhum jogo vira falta.
 *
 * A escalação por jogo (`game_players`) é o registro mais fiel de quem esteve
 * na quadra: ela sobrevive a troca de colete, a quem chegou atrasado e a quem o
 * admin incluiu na mão. Se alguém está `in` e não aparece em nenhum jogo da
 * fut, ou não foi, ou o admin esqueceu de desmarcar — e nos dois casos contar
 * presença é mentira no ranking.
 *
 * Roda no commit do encerramento, e não antes, porque até ali a escalação ainda
 * muda. O admin que discordar desmarca depois? Não: encerrada, a escalação é
 * imutável. Por isso a tela de encerramento mostra quem vai virar falta antes de
 * confirmar — e é lá que se conserta, incluindo a pessoa no jogo.
 *
 * `totalDeJogos` vem de quem chama porque a consulta já foi feita. E ele é a
 * guarda que importa: **fut sem jogo lançado não marca falta em ninguém**.
 * Sem isso, encerrar um fut em que o placar não foi registrado zeraria a
 * presença de todo mundo que estava lá.
 */
async function marcarFaltasAutomaticas(
  tx: Executor,
  matchDayId: number,
  totalDeJogos: number,
): Promise<void> {
  if (totalDeJogos === 0) return;

  await tx
    .update(attendances)
    .set({ status: "no_show", updatedAt: new Date() })
    .where(
      and(
        eq(attendances.matchDayId, matchDayId),
        eq(attendances.status, "in"),
        notExists(
          tx
            .select({ um: sql`1` })
            .from(gamePlayers)
            .innerJoin(games, eq(games.id, gamePlayers.gameId))
            .where(
              and(
                eq(games.matchDayId, matchDayId),
                eq(gamePlayers.playerId, attendances.playerId),
              ),
            ),
        ),
      ),
    );
}

export async function confirmarEncerramento(matchDayId: number) {
  const { matchDay } = await requireFutAdmin(matchDayId);
  if (matchDay.status === "finished") redirect(`/fut/${matchDayId}/gerenciar`);

  // Um jogo sem gente dos dois lados não tem placar que faça sentido, nem
  // companheiro para avaliar.
  const lados = await db
    .select({
      gameId: games.id,
      ladoA: sql<number>`count(*) filter (where ${gamePlayers.side} = 'A')::int`,
      ladoB: sql<number>`count(*) filter (where ${gamePlayers.side} = 'B')::int`,
    })
    .from(games)
    .leftJoin(gamePlayers, eq(gamePlayers.gameId, games.id))
    .where(eq(games.matchDayId, matchDayId))
    .groupBy(games.id);

  if (lados.some((l) => l.ladoA === 0 || l.ladoB === 0)) {
    redirect(`/fut/${matchDayId}/gerenciar/encerrar?erro=jogo-sem-time`);
  }

  // Jogo com súmula ao vivo aberta trava o encerramento — finalizar de ofício
  // gravaria um fim que ninguém pediu e mascararia o esquecimento; o erro
  // aponta o caminho. A checagem repete DENTRO da transação porque é lá, sob o
  // mesmo lock que o iniciarJogo da súmula disputa, que ela vira garantia.
  const jogoAberto = and(
    eq(games.matchDayId, matchDayId),
    isNotNull(games.startedAt),
    isNull(games.finishedAt),
  );
  const emAndamento = await db.select({ id: games.id }).from(games).where(jogoAberto);
  if (emAndamento.length > 0) {
    redirect(`/fut/${matchDayId}/gerenciar/encerrar?erro=jogo-em-andamento`);
  }

  // Encerrar com a escalação confirmada é o gatilho da avaliação, e as duas
  // coisas têm que ser o mesmo commit: um fut que ficasse `finished` sem
  // rodada seria um beco sem saída — a checagem de `finished` acima impede repetir a ação, o
  // varredor só fecha rodada que já existe, e não existe "reabrir fut".
  await db.transaction(async (tx) => {
    // O mesmo lock das escritas da lista: sem ele, uma inclusão concorrente
    // passa entre o marcarFaltasAutomaticas e o commit — e entra `in` numa
    // fut que acabou de encerrar, sem ter jogado.
    await travarFut(tx, matchDayId);
    // Re-check sob o lock: um iniciarJogo concorrente também trava o fut, então
    // ou ele commitou antes (e este select o vê), ou está esperando o lock (e o
    // status `finished` deste commit o recusará). O redirect daqui lança e
    // desfaz a transação — nenhum write aconteceu ainda.
    const aindaAberto = await tx.select({ id: games.id }).from(games).where(jogoAberto);
    if (aindaAberto.length > 0) {
      redirect(`/fut/${matchDayId}/gerenciar/encerrar?erro=jogo-em-andamento`);
    }
    await marcarFaltasAutomaticas(tx, matchDayId, lados.length);

    await tx
      .update(matchDays)
      .set({ status: "finished", finishedAt: sql`now()` })
      .where(eq(matchDays.id, matchDayId));

    await abrirRodada(tx, matchDayId);
  });

  revalidatePath("/");
  revalidatePath("/futs");
  revalidatePath("/artilharia");
  revalidatePath("/rankings");
  revalidar(matchDayId);
  redirect(`/fut/${matchDayId}/gerenciar`);
}
