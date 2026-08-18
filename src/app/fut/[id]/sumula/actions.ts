"use server";

// As actions da súmula ao vivo. O contrato do painel é diferente do /gerenciar:
// lá o admin digita um resultado pronto; aqui cada toque é um evento — o placar
// incrementa e o gol entra na MESMA transação, então os dois nunca nascem
// dessincronizados (o dado continua independente: o /gerenciar segue podendo
// divergi-los, ver o comentário de `goals` no schema).
//
// Concorrência é regra, não exceção — dois operadores, ou o admin encerrando o
// fut enquanto alguém lança: todo write de jogo carrega o predicado de "em
// andamento" no próprio WHERE (started_at preenchido, finished_at nulo) e
// decide pelo `.returning()`. Sem linha, o jogo mudou de estado entre o render
// e o toque, e a action recusa em vez de escrever por cima.

import { redirect } from "next/navigation";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { gamePlayers, games, goals, sumulaOperadores, teams } from "@/db/schema";
import { criarJogoComEscalacao } from "@/lib/jogos";
import { travarFut } from "@/lib/presenca";
import { requireFutAdmin } from "@/lib/require-fut-admin";
import { requireOperadorSumula } from "@/lib/require-operador-sumula";
import { ehElegivelParaSumula } from "@/lib/sumula-elegiveis";
import { jogoEmAndamento, podeDesfazerLancamento, sumulaDisponivel } from "@/lib/sumula";
import { revalidateMatchDay } from "../revalidate";

/**
 * "É o lançamento ativo mais recente do lado dele?" — o recorte do delegado,
 * inteiro em SQL, sem relógio da aplicação.
 *
 * Uma definição só, usada nos DOIS lugares que precisam dela: a leitura que
 * decide a mensagem de erro amigável, e o WHERE do update que a torna à prova
 * de corrida. Enquanto só a leitura tinha o predicado, dois operadores
 * concorrentes furavam a regra — o delegado lia o gol como último, alguém
 * lançava no mesmo lado, e o desfazer passava assim mesmo.
 *
 * O universo é o dos lançamentos da súmula (`somado_no_placar`): é o mesmo
 * conjunto que o painel lista, então "o último" quer dizer a mesma coisa na
 * tela e aqui.
 */
const ULTIMO_DO_LADO = sql<boolean>`not exists (
  select 1 from goals g2
  where g2.game_id = ${goals.gameId}
    and g2.side is not distinct from ${goals.side}
    and g2.somado_no_placar
    and g2.desfeito_em is null
    and g2.id > ${goals.id}
)`;

/**
 * Abre um jogo 0×0 em andamento. Um por vez — é o invariante do painel: os
 * botões de gol não perguntam "de qual jogo", então não pode haver dúvida.
 */
export async function iniciarJogo(matchDayId: number, formData: FormData) {
  await requireOperadorSumula(matchDayId);
  const teamAId = Number(formData.get("teamAId"));
  const teamBId = Number(formData.get("teamBId"));
  if (!Number.isInteger(teamAId) || !Number.isInteger(teamBId) || teamAId === teamBId) {
    redirect(`/fut/${matchDayId}/sumula?erro=dados-invalidos`);
  }

  const dayTeams = await db.select().from(teams).where(eq(teams.matchDayId, matchDayId));
  const teamIds = new Set(dayTeams.map((t) => t.id));
  if (!teamIds.has(teamAId) || !teamIds.has(teamBId)) {
    redirect(`/fut/${matchDayId}/sumula?erro=dados-invalidos`);
  }

  await db.transaction(async (tx) => {
    // O mesmo lock do encerramento: confirmarEncerramento também trava o fut
    // antes de decidir, então ou este jogo nasce antes (e o encerramento
    // recusa por jogo aberto), ou o fut encerra antes (e o re-check abaixo
    // recusa). Os redirects daqui de dentro lançam e desfazem a transação —
    // não há write nenhum antes deles, então o rollback é vazio.
    // Mesma regra que decide o link e a página (src/lib/sumula.ts), afirmada
    // aqui dentro porque é aqui que ela vira garantia. Os dois slugs ficam
    // literais de propósito: é assim que mensagens.test.ts enxerga que eles são
    // emitidos.
    const fut = await travarFut(tx, matchDayId);
    if (fut.status === "finished") {
      redirect(`/fut/${matchDayId}/sumula?erro=fut-encerrado`);
    }
    if (!sumulaDisponivel(fut)) {
      redirect(`/fut/${matchDayId}/sumula?erro=sumula-indisponivel`);
    }

    const jogos = await tx
      .select({ startedAt: games.startedAt, finishedAt: games.finishedAt })
      .from(games)
      .where(eq(games.matchDayId, matchDayId));
    if (jogos.some(jogoEmAndamento)) {
      redirect(`/fut/${matchDayId}/sumula?erro=ja-tem-jogo-aberto`);
    }

    await criarJogoComEscalacao(tx, {
      matchDayId,
      teamAId,
      teamBId,
      scoreA: 0,
      scoreB: 0,
      sortOrder: jogos.length,
      emAndamento: true,
    });
  });
  revalidateMatchDay(matchDayId);
}

/**
 * Um toque, um gol: incrementa o placar do lado e insere o lançamento no mesmo
 * commit. `playerId` ausente é o botão "gol contra / sem autor" — soma no
 * placar sem creditar artilharia (o autor pode ser atribuído depois, no
 * /gerenciar).
 */
export async function lancarGol(matchDayId: number, gameId: number, formData: FormData) {
  const { session } = await requireOperadorSumula(matchDayId);
  if (!Number.isInteger(gameId)) redirect(`/fut/${matchDayId}/sumula?erro=dados-invalidos`);

  const side = formData.get("side");
  if (side !== "A" && side !== "B") redirect(`/fut/${matchDayId}/sumula?erro=dados-invalidos`);

  const playerIdRaw = formData.get("playerId");
  const playerId =
    playerIdRaw === null || playerIdRaw === "" ? null : Number(playerIdRaw);
  if (playerId !== null && !Number.isInteger(playerId)) {
    redirect(`/fut/${matchDayId}/sumula?erro=dados-invalidos`);
  }

  if (playerId !== null) {
    // A mesma trava do addGoal, mais o lado: gol creditado a quem não está
    // escalado — ou escalado do outro lado — é placar inventado na artilharia.
    //
    // O join com `games` escopa o `gameId`, que vem do cliente, pelos jogos
    // deste fut: sem ele, a diferença entre os dois redirects daqui viraria um
    // oráculo da escalação de fut alheio para qualquer operador logado.
    const [escalado] = await db
      .select({ side: gamePlayers.side })
      .from(gamePlayers)
      .innerJoin(games, and(eq(games.id, gamePlayers.gameId), eq(games.matchDayId, matchDayId)))
      .where(and(eq(gamePlayers.gameId, gameId), eq(gamePlayers.playerId, playerId)));
    if (!escalado || escalado.side !== side) {
      redirect(`/fut/${matchDayId}/sumula?erro=artilheiro-fora-do-jogo`);
    }
  }

  await db.transaction(async (tx) => {
    // O incremento atômico com o predicado de "em andamento" é o guard de
    // corrida: se outro operador finalizou o jogo entre o render e o toque,
    // nenhuma linha volta e nada é gravado.
    const [aberto] = await tx
      .update(games)
      .set(
        side === "A"
          ? { scoreA: sql`${games.scoreA} + 1` }
          : { scoreB: sql`${games.scoreB} + 1` },
      )
      .where(
        and(
          eq(games.id, gameId),
          // Escopo pelo fut: `gameId` vem do cliente, e o guard só validou o
          // operador DESTE fut.
          eq(games.matchDayId, matchDayId),
          isNotNull(games.startedAt),
          isNull(games.finishedAt),
        ),
      )
      .returning({ id: games.id });
    if (!aberto) redirect(`/fut/${matchDayId}/sumula?erro=jogo-nao-esta-aberto`);

    // `somadoNoPlacar` é o que autoriza o desfazer a decrementar depois: só
    // esta action incrementa o placar junto, então só as linhas dela podem
    // devolvê-lo (ver o comentário da coluna no schema).
    await tx.insert(goals).values({
      gameId,
      playerId,
      side,
      quantity: 1,
      somadoNoPlacar: true,
      createdByPlayerId: session.player.id,
    });
  });
  revalidateMatchDay(matchDayId);
}

/**
 * O desfazer do painel — soft-delete com decremento, e a regra do "recente"
 * (src/lib/sumula.ts): delegado só desfaz o lançamento ativo mais recente de
 * cada lado; admin do fut desfaz qualquer um do jogo em andamento.
 */
export async function desfazerLancamento(matchDayId: number, goalId: number) {
  const { session, ehAdminDoFut } = await requireOperadorSumula(matchDayId);
  if (!Number.isInteger(goalId)) redirect(`/fut/${matchDayId}/sumula?erro=dados-invalidos`);

  // Uma query decide tudo: o lançamento ativo, o estado do jogo e se ele é o
  // último ativo do lado — o recorte que a regra do delegado precisa, resolvido
  // pelo Postgres (nada de relógio da aplicação). O join com `games` também
  // escopa o `goalId`, que vem do cliente, pelos jogos deste fut.
  //
  // `somado_no_placar` recorta o universo aos lançamentos da própria súmula. Um
  // gol lançado pelo addGoal do /gerenciar não entrou no placar (lá o número é
  // digitado à parte) e pode vir com quantidade até 20 — desfazê-lo por aqui
  // comeria do placar ao vivo o que ele nunca somou.
  const [lancamento] = await db
    .select({
      gameId: goals.gameId,
      side: goals.side,
      quantity: goals.quantity,
      startedAt: games.startedAt,
      finishedAt: games.finishedAt,
      ultimoDoLado: ULTIMO_DO_LADO,
    })
    .from(goals)
    .innerJoin(games, and(eq(games.id, goals.gameId), eq(games.matchDayId, matchDayId)))
    .where(
      and(eq(goals.id, goalId), eq(goals.somadoNoPlacar, true), isNull(goals.desfeitoEm)),
    );
  if (!lancamento) redirect(`/fut/${matchDayId}/sumula?erro=dados-invalidos`);

  // Gol sem lado (linha anterior à súmula) não diz de que placar sair — e um
  // gol desses num jogo em andamento nem deveria existir, porque tanto a
  // súmula quanto o addGoal atual gravam o lado sempre.
  if (
    lancamento.side === null ||
    !podeDesfazerLancamento({
      ehAdminDoFut,
      jogoEmAndamento: jogoEmAndamento(lancamento),
      ultimoDoLado: lancamento.ultimoDoLado,
    })
  ) {
    redirect(`/fut/${matchDayId}/sumula?erro=desfazer-indisponivel`);
  }

  const side = lancamento.side;
  await db.transaction(async (tx) => {
    // O decremento vem primeiro e com o predicado de "em andamento": se o jogo
    // foi finalizado entre a decisão acima e este commit, nada volta e o gol
    // NÃO é marcado — desfazer depois do fim é assunto do /gerenciar.
    const [aberto] = await tx
      .update(games)
      .set(
        side === "A"
          ? { scoreA: sql`greatest(${games.scoreA} - ${lancamento.quantity}, 0)` }
          : { scoreB: sql`greatest(${games.scoreB} - ${lancamento.quantity}, 0)` },
      )
      .where(
        and(
          eq(games.id, lancamento.gameId),
          isNotNull(games.startedAt),
          isNull(games.finishedAt),
        ),
      )
      .returning({ id: games.id });
    if (!aberto) redirect(`/fut/${matchDayId}/sumula?erro=jogo-nao-esta-aberto`);

    // `desfeito_em is null` de novo: se outro operador desfez este mesmo gol
    // no meio, o rollback devolve o decremento e o placar não cai duas vezes.
    //
    // E, para o delegado, o `ULTIMO_DO_LADO` REPETIDO aqui: a decisão lá em
    // cima roda fora da transação, então entre ela e este commit outro operador
    // pode ter lançado no mesmo lado — e aí este já não é o último. Sem linha,
    // o redirect desfaz o decremento junto.
    const [desfeito] = await tx
      .update(goals)
      .set({ desfeitoEm: sql`now()`, desfeitoPorPlayerId: session.player.id })
      .where(
        and(
          eq(goals.id, goalId),
          isNull(goals.desfeitoEm),
          ehAdminDoFut ? undefined : ULTIMO_DO_LADO,
        ),
      )
      .returning({ id: goals.id });
    if (!desfeito) redirect(`/fut/${matchDayId}/sumula?erro=desfazer-indisponivel`);
  });
  revalidateMatchDay(matchDayId);
}

export async function finalizarJogo(matchDayId: number, gameId: number) {
  await requireOperadorSumula(matchDayId);
  if (!Number.isInteger(gameId)) redirect(`/fut/${matchDayId}/sumula?erro=dados-invalidos`);

  const [finalizado] = await db
    .update(games)
    .set({ finishedAt: sql`now()` })
    .where(
      and(
        eq(games.id, gameId),
        eq(games.matchDayId, matchDayId),
        isNotNull(games.startedAt),
        isNull(games.finishedAt),
      ),
    )
    .returning({ id: games.id });
  if (!finalizado) redirect(`/fut/${matchDayId}/sumula?erro=jogo-nao-esta-aberto`);
  revalidateMatchDay(matchDayId);
}

/**
 * "Passar a súmula". Guard de admin, não de operador: delegado não delega —
 * senão a lista de quem pode lançar cresceria fora do controle de quem
 * organiza, e a delegação é justamente a resposta ao abuso.
 */
export async function delegarSumula(matchDayId: number, formData: FormData) {
  const { session } = await requireFutAdmin(matchDayId);
  const playerId = Number(formData.get("playerId"));
  if (!Number.isInteger(playerId)) redirect(`/fut/${matchDayId}/sumula?erro=dados-invalidos`);

  // Conta ativa e presença `in` neste fut — a condição mora em
  // src/lib/sumula-elegiveis.ts, junto com o select que oferece os candidatos e
  // o guard que a reafirma a cada request.
  if (!(await ehElegivelParaSumula(matchDayId, playerId))) {
    redirect(`/fut/${matchDayId}/sumula?erro=operador-invalido`);
  }

  await db
    .insert(sumulaOperadores)
    .values({ matchDayId, playerId, createdByPlayerId: session.player.id })
    .onConflictDoNothing();
  revalidateMatchDay(matchDayId);
}

export async function revogarSumula(matchDayId: number, playerId: number) {
  await requireFutAdmin(matchDayId);
  if (!Number.isInteger(playerId)) redirect(`/fut/${matchDayId}/sumula?erro=dados-invalidos`);

  await db
    .delete(sumulaOperadores)
    .where(
      and(eq(sumulaOperadores.matchDayId, matchDayId), eq(sumulaOperadores.playerId, playerId)),
    );
  revalidateMatchDay(matchDayId);
}
