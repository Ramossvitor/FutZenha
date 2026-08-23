"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, isNotNull, isNull, ne, notExists, sql } from "drizzle-orm";
import { db, type Executor } from "@/db";
import { attendances, gamePlayers, games, goals, matchDays } from "@/db/schema";
import { formatDate } from "@/lib/format";
import { revalidateMatchDay } from "../../revalidate";
import { agendarResumoDoFut } from "@/lib/email-resumo";
import { notificarEncerramento } from "@/lib/encerramento-avisos";
import { congelarMultiplicadores } from "@/lib/multiplicador-engine";
import { notificar } from "@/lib/notifications";
import { avaliarMarcacao, entrarNaLista, mereceAviso, travarFut } from "@/lib/presenca";
import { agendarDespachoDePush } from "@/lib/push-envio";
import { abrirRodada } from "@/lib/ratings-engine";
import { esquecerStats } from "@/lib/stats";
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

// Os ids chegam pelo `.bind` — corpo do POST. A guarda é a mesma do
// `incluirNoJogo` aqui embaixo, e a razão de existir nas três é a mesma: sem
// ela um id não-inteiro atravessa até o driver e vira 500 cru no lugar do
// banner que estas telas sabem mostrar. Não é escopo (o `assertEditavel` já
// amarra o jogo a este fut), é a diferença entre erro tratado e tela branca.
function exigirIdsInteiros(matchDayId: number, ...ids: number[]): void {
  if (!ids.every(Number.isInteger)) {
    redirect(`/fut/${matchDayId}/gerenciar/encerrar?erro=dados-invalidos`);
  }
}

/**
 * A correção da escalação DEPOIS do jogo, na tela de encerramento: troca o lado
 * e pronto. É a irmã de `trocarDeLado` (src/app/fut/[id]/sumula/actions.ts) e as
 * duas não se fundem de propósito — lá é evento de jogo em andamento, com log
 * visível na súmula, o colete do fut movido junto e operador (não só admin);
 * aqui é conserto de admin sobre jogo parado, sem nada disso.
 *
 * E uma diferença a mais: os gols da pessoa neste jogo TROCAM junto. Lá a troca
 * é um evento — o gol saiu pelo lado em que ela estava na hora, e fica. Aqui é
 * correção: a escalação estava errada, e o `goals.side` que o lançamento copiou
 * dela estava errado pelo mesmo motivo. Como o `coleteDoGol` (src/lib/resumo.ts)
 * lê o `side` gravado antes da escalação, deixar o gol parado faria o conserto
 * não aparecer no chip do gol.
 */
export async function moverLado(matchDayId: number, gameId: number, playerId: number) {
  await requireFutAdmin(matchDayId);
  exigirIdsInteiros(matchDayId, gameId, playerId);
  await assertEditavel(matchDayId, gameId);

  await db.transaction(async (tx) => {
    await tx
      .update(gamePlayers)
      .set({ side: sql`case when ${gamePlayers.side} = 'A' then 'B'::game_side else 'A'::game_side end` })
      .where(and(eq(gamePlayers.gameId, gameId), eq(gamePlayers.playerId, playerId)));
    // Só os gols com lado gravado: o nulo é de antes da súmula e continua sendo
    // derivado da escalação, que acabou de mudar.
    await tx
      .update(goals)
      .set({ side: sql`case when ${goals.side} = 'A' then 'B'::game_side else 'A'::game_side end` })
      .where(
        and(eq(goals.gameId, gameId), eq(goals.playerId, playerId), isNotNull(goals.side)),
      );
  });
  revalidar(matchDayId);
}

// Tirar do jogo não tira a presença: dá para ter ido ao fut e não ter jogado
// aquela partida.
export async function removerDoJogo(matchDayId: number, gameId: number, playerId: number) {
  await requireFutAdmin(matchDayId);
  exigirIdsInteiros(matchDayId, gameId, playerId);
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
  exigirIdsInteiros(matchDayId, gameId, playerId);
  if (side !== "A" && side !== "B") {
    redirect(`/fut/${matchDayId}/gerenciar/encerrar?erro=dados-invalidos`);
  }
  await assertEditavel(matchDayId, gameId);
  // Escalar marca presença junto, então vale o mesmo limite do definirPresenca:
  // quem tem conta ativa e nunca entrou neste fut só é escalado por outro se
  // for elegível — e aqui a lista está sempre fechada, porque já existe jogo.
  const { permitido, alvo } = await avaliarMarcacao(session, matchDay, playerId);
  if (!permitido) {
    // Quem recusou não é escalado por outro, nem aqui. É o caso mais áspero da
    // regra — a pessoa pode estar na quadra —, e por isso a mensagem ensina a
    // saída: ela entra sozinha pelo celular, e o botão "Vou" volta a aparecer
    // justamente para quem recusou (ver podeMexerNoProprioNome).
    //
    // Literais, e não um ternário interpolado: ver o mesmo ponto em
    // ../actions.ts (a varredura de slugs de src/lib/mensagens.test.ts).
    if (alvo.recusou) redirect(`/fut/${matchDayId}/gerenciar/encerrar?erro=recusou`);
    redirect(`/fut/${matchDayId}/gerenciar/encerrar?erro=precisa-confirmar`);
  }

  let avisou = false;
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
    const entrada = await entrarNaLista(tx, matchDay.id, playerId, session.player.id);

    if (mereceAviso(session, playerId, alvo, entrada)) {
      avisou = true;
      await notificar(tx, [
        {
          playerId,
          type: "pelada_presenca_definida",
          title: "Marcaram sua presença num fut",
          body: `${session.player.name} escalou você no fut de ${formatDate(matchDay.date)}, em ${matchDay.location}. Se não for, retire seu nome pela página do fut.`,
          href: `/fut/${matchDayId}`,
          dedupeKey: `presenca:${matchDayId}:${playerId}`,
        },
      ]);
    }
  });
  // Fura o throttle, como no definirPresenca: ser escalado num jogo que já está
  // acontecendo é o aviso mais sensível a tempo que existe — esperar a próxima
  // varredura entregaria "você está jogando" depois do apito final.
  if (avisou) agendarDespachoDePush(true);
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
  const { session, matchDay } = await requireFutAdmin(matchDayId);
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

    // A transição é `UPDATE ... WHERE status <> 'finished' RETURNING`, e não um
    // update pelo id: a checagem lá de cima roda ANTES da transação, então dois
    // cliques simultâneos passam os dois por ela e chegam aqui em fila no lock.
    // Zero linhas = o outro já encerrou, e sair aqui é o que impede o segundo
    // commit de re-notificar todo mundo e de reabrir a contagem do que vier
    // depender do encerramento.
    const encerrados = await tx
      .update(matchDays)
      .set({ status: "finished", finishedAt: sql`now()` })
      .where(and(eq(matchDays.id, matchDayId), ne(matchDays.status, "finished")))
      .returning({ id: matchDays.id });
    if (encerrados.length === 0) return;

    // O aviso do encerramento é UM só por pessoa, e por isso ele sai daqui e
    // não de dentro do abrirRodada: quem monta precisa saber tanto de quem
    // avalia quanto de quem jogou e NÃO avalia — e de quem é do grupo e nem
    // jogou. O `abrirRodada` devolve o eleitorado justamente para isso.
    const rodada = await abrirRodada(tx, matchDayId);
    await notificarEncerramento(tx, matchDay, rodada, session.player.id);

    // No MESMO commit do encerramento: é aqui que os multiplicadores armados
    // viram fato durável (ou voltam para o inventário de quem não jogou). Um
    // fut que ficasse `finished` com armes pendurados deixaria a pessoa sem o
    // item e sem o efeito, e não existe "reabrir fut" para consertar.
    await congelarMultiplicadores(tx, matchDayId, rodada?.roundId ?? null);
  });

  // Fura o throttle: "acabou o fut, vem ver como foi" perde o sentido se chegar
  // no próximo pageview de outra pessoa. Fora da transação, porque rede dentro
  // dela é o que a casa não faz.
  agendarDespachoDePush(true);
  // O e-mail com o placar também só depois do commit, e no `after()` — são até
  // 20 POSTs sequenciais para o Resend, que não podem segurar o redirect nem
  // viver dentro de uma transação.
  agendarResumoDoFut(matchDayId);

  revalidatePath("/");
  revalidatePath("/futs");
  revalidatePath("/artilharia");
  revalidatePath("/rankings");
  // O memo de src/lib/stats.ts guarda os agregados por até MEMO_TTL_MS; sem
  // isto, o ranking e o perfil público ficariam com o número velho por esse
  // tempo depois de uma mudança que os afeta.
  esquecerStats();
  revalidar(matchDayId);
  redirect(`/fut/${matchDayId}/gerenciar`);
}
