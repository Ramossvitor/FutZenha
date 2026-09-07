import "server-only";

// O corpo da súmula ao vivo, com um chamador de cada lado: as Server Actions
// do painel (src/app/(esqueleto)/fut/[id]/sumula/actions.ts) e a API do relógio
// (src/app/api/sumula). Mora em src/lib como todo módulo com dois chamadores
// (recarga.ts, jogos.ts, presenca.ts) — e mensagens.test.ts sabe olhar aqui. Os dois
// autorizam do seu jeito — cookie e 404 lá, Bearer e JSON aqui — e chegam com o
// `OperadorDeSumula` já na mão; o que muda entre eles é só como uma recusa vira
// resposta. Por isso a recusa daqui é um `ErroDaSumula` com o slug de
// src/lib/mensagens.ts, que cada chamador traduz (redirect com `?erro=` no
// painel, JSON com status na API).
//
// Lançado de DENTRO de `db.transaction`, o erro faz o rollback e sai — exatamente
// o que o `redirect()` fazia quando este código morava na action. Nada mudou de
// lugar na transação por causa da extração; o teste de integração das actions
// continua valendo linha a linha.
//
// Concorrência é regra, não exceção — dois operadores, ou o admin encerrando o
// fut enquanto alguém lança: todo write de jogo carrega o predicado de "em
// andamento" no próprio WHERE (started_at preenchido, finished_at nulo) e
// decide pelo `.returning()`. Sem linha, o jogo mudou de estado entre o render
// e o toque, e a operação recusa em vez de escrever por cima.

import { and, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  gamePlayers,
  games,
  goals,
  teamPlayers,
  teams,
  trocasDeLado,
  type Game,
} from "@/db/schema";
import { criarJogoComEscalacao } from "@/lib/jogos";
import { travarFut } from "@/lib/presenca";
import type { OperadorDeSumula } from "@/lib/require-operador-sumula";
import { jogoEmAndamento, podeDesfazerLancamento, sumulaDisponivel } from "@/lib/sumula";

/**
 * A recusa de negócio da súmula. O `slug` é uma chave de src/lib/mensagens.ts
 * — sempre string literal no `new`, porque é assim que mensagens.test.ts
 * confere que todo slug emitido tem mensagem.
 */
export class ErroDaSumula extends Error {
  readonly slug: string;

  constructor(slug: string) {
    super(`súmula recusou: ${slug}`);
    this.name = "ErroDaSumula";
    this.slug = slug;
  }
}

export type Lado = "A" | "B";

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
export async function iniciarJogo(
  operador: OperadorDeSumula,
  params: { teamAId: number; teamBId: number },
): Promise<Game> {
  const matchDayId = operador.matchDay.id;
  const { teamAId, teamBId } = params;
  if (!Number.isInteger(teamAId) || !Number.isInteger(teamBId) || teamAId === teamBId) {
    throw new ErroDaSumula("dados-invalidos");
  }

  const dayTeams = await db.select().from(teams).where(eq(teams.matchDayId, matchDayId));
  const teamIds = new Set(dayTeams.map((t) => t.id));
  if (!teamIds.has(teamAId) || !teamIds.has(teamBId)) {
    throw new ErroDaSumula("dados-invalidos");
  }

  return db.transaction(async (tx) => {
    // O mesmo lock do encerramento: confirmarEncerramento também trava o fut
    // antes de decidir, então ou este jogo nasce antes (e o encerramento
    // recusa por jogo aberto), ou o fut encerra antes (e o re-check abaixo
    // recusa). Os erros daqui de dentro lançam e desfazem a transação — não há
    // write nenhum antes deles, então o rollback é vazio.
    // Mesma regra que decide o link e a página (src/lib/sumula.ts), afirmada
    // aqui dentro porque é aqui que ela vira garantia.
    const fut = await travarFut(tx, matchDayId);
    if (fut.status === "finished") {
      throw new ErroDaSumula("fut-encerrado");
    }
    if (!sumulaDisponivel(fut)) {
      throw new ErroDaSumula("sumula-indisponivel");
    }

    const jogos = await tx
      .select({ startedAt: games.startedAt, finishedAt: games.finishedAt })
      .from(games)
      .where(eq(games.matchDayId, matchDayId));
    if (jogos.some(jogoEmAndamento)) {
      throw new ErroDaSumula("ja-tem-jogo-aberto");
    }

    return criarJogoComEscalacao(tx, {
      matchDayId,
      teamAId,
      teamBId,
      scoreA: 0,
      scoreB: 0,
      sortOrder: jogos.length,
      emAndamento: true,
    });
  });
}

/**
 * Um toque, um gol: incrementa o placar do lado e insere o lançamento no mesmo
 * commit. `playerId` nulo é o botão "gol contra / sem autor" — soma no placar
 * sem creditar artilharia (o autor pode ser atribuído depois, no /gerenciar).
 *
 * Devolve o placar que o próprio UPDATE produziu: é o que a API do relógio
 * responde, sem uma segunda leitura que já poderia estar diferente.
 */
export async function lancarGol(
  operador: OperadorDeSumula,
  params: { gameId: number; side: Lado; playerId: number | null },
): Promise<{ goalId: number; scoreA: number; scoreB: number }> {
  const matchDayId = operador.matchDay.id;
  const { gameId, side, playerId } = params;

  return db.transaction(async (tx) => {
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
      .returning({ id: games.id, scoreA: games.scoreA, scoreB: games.scoreB });
    if (!aberto) throw new ErroDaSumula("jogo-nao-esta-aberto");

    if (playerId !== null) {
      // A mesma trava do addGoal, mais o lado: gol creditado a quem não está
      // escalado — ou escalado do outro lado — é placar inventado na artilharia.
      //
      // DENTRO da transação e DEPOIS do update acima, de propósito: o
      // `trocarDeLado` trava a linha de `games` com `for update`, então este
      // update espera o commit da troca e a escalação lida aqui já é a de
      // depois dela. Enquanto a leitura era pré-transação, um gol tocado no
      // instante da troca nascia com o lado velho — o placar subia de um lado
      // e o autor já jogava no outro.
      //
      // O join com `games` escopa o `gameId`, que vem do cliente, pelos jogos
      // deste fut: sem ele, a diferença entre as duas recusas daqui viraria um
      // oráculo da escalação de fut alheio para qualquer operador logado. O
      // erro desfaz o incremento junto, porque lança de dentro da transação.
      const [escalado] = await tx
        .select({ side: gamePlayers.side })
        .from(gamePlayers)
        .innerJoin(games, and(eq(games.id, gamePlayers.gameId), eq(games.matchDayId, matchDayId)))
        .where(and(eq(gamePlayers.gameId, gameId), eq(gamePlayers.playerId, playerId)));
      if (!escalado || escalado.side !== side) {
        throw new ErroDaSumula("artilheiro-fora-do-jogo");
      }
    }

    // `somadoNoPlacar` é o que autoriza o desfazer a decrementar depois: só
    // esta operação incrementa o placar junto, então só as linhas dela podem
    // devolvê-lo (ver o comentário da coluna no schema).
    const [gol] = await tx
      .insert(goals)
      .values({
        gameId,
        playerId,
        side,
        quantity: 1,
        somadoNoPlacar: true,
        createdByPlayerId: operador.session.player.id,
      })
      .returning({ id: goals.id });

    return { goalId: gol.id, scoreA: aberto.scoreA, scoreB: aberto.scoreB };
  });
}

/**
 * O desfazer do painel — soft-delete com decremento, e a regra do "recente"
 * (src/lib/sumula.ts): delegado só desfaz o lançamento ativo mais recente de
 * cada lado; admin do fut desfaz qualquer um do jogo em andamento.
 *
 * `exigirUltimoDoLado` é para quem NÃO escolheu o gol — o "Desfazer A" do
 * relógio, que lê o último do lado e manda o id. Se entre essa leitura e o
 * commit alguém lançou no mesmo lado, o id já não é o último, e o admin
 * desfaria em silêncio um gol mais antigo: o placar cai igual, mas a
 * artilharia perde o gol da pessoa errada. Com a exigência, a trava do
 * delegado vale para ele também.
 */
export async function desfazerLancamento(
  operador: OperadorDeSumula,
  params: { goalId: number; exigirUltimoDoLado?: boolean },
): Promise<{ side: Lado; scoreA: number; scoreB: number }> {
  const matchDayId = operador.matchDay.id;
  const { ehAdminDoFut } = operador;
  const { goalId } = params;
  const soOUltimoDoLado = !ehAdminDoFut || params.exigirUltimoDoLado === true;

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
  if (!lancamento) throw new ErroDaSumula("dados-invalidos");

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
    throw new ErroDaSumula("desfazer-indisponivel");
  }

  const side = lancamento.side;
  return db.transaction(async (tx) => {
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
      .returning({ id: games.id, scoreA: games.scoreA, scoreB: games.scoreB });
    if (!aberto) throw new ErroDaSumula("jogo-nao-esta-aberto");

    // `desfeito_em is null` de novo: se outro operador desfez este mesmo gol
    // no meio, o rollback devolve o decremento e o placar não cai duas vezes.
    //
    // E, para o delegado (ou para quem desfaz "pelo lado"), o `ULTIMO_DO_LADO`
    // REPETIDO aqui: a decisão lá em cima roda fora da transação, então entre
    // ela e este commit outro operador pode ter lançado no mesmo lado — e aí
    // este já não é o último. Sem linha, o erro desfaz o decremento junto.
    const [desfeito] = await tx
      .update(goals)
      .set({ desfeitoEm: sql`now()`, desfeitoPorPlayerId: operador.session.player.id })
      .where(
        and(
          eq(goals.id, goalId),
          isNull(goals.desfeitoEm),
          soOUltimoDoLado ? ULTIMO_DO_LADO : undefined,
        ),
      )
      .returning({ id: goals.id });
    if (!desfeito) throw new ErroDaSumula("desfazer-indisponivel");

    return { side, scoreA: aberto.scoreA, scoreB: aberto.scoreB };
  });
}

/**
 * Passa um jogador para o outro lado com o jogo rolando — o que acontece na
 * quadra quando um time fica desfalcado, alguém se machuca ou chega gente.
 *
 * Escreve TRÊS coisas no mesmo commit, e cada uma responde por uma pergunta
 * diferente:
 *
 * - `game_players.side` — o lado em que a pessoa TERMINOU o jogo. É de onde
 *   saem o V/E/D (src/lib/stats.ts) e os companheiros da avaliação
 *   (src/lib/ratings.ts), então os dois seguem a troca sem nenhum código novo.
 *   Os gols já lançados NÃO se mexem: `goals.side` guarda o lado do momento em
 *   que cada um saiu, e é por isso que ele passa na frente da escalação no
 *   `coleteDoGol` (src/lib/resumo.ts).
 * - `team_players` — o colete do fut, para o PRÓXIMO jogo nascer com ela no
 *   time novo (`criarJogoComEscalacao` tira o snapshot daqui).
 * - `trocas_de_lado` — o log que o painel mostra na linha do tempo.
 *
 * Sem desfazer: voltar é trocar de novo, e as duas linhas ficam no histórico.
 *
 * Delegado também troca — quem está com o celular é quem vê a quadra. A regra
 * do "último do lado" do desfazer não tem análogo aqui: trocar não reescreve
 * placar nem artilharia de ninguém, e a troca errada se conserta com outra.
 */
export async function trocarDeLado(
  operador: OperadorDeSumula,
  params: { gameId: number; playerId: number },
): Promise<{ de: Lado; para: Lado }> {
  const matchDayId = operador.matchDay.id;
  const { gameId, playerId } = params;

  return db.transaction(async (tx) => {
    // O mesmo lock de `iniciarJogo` e do encerramento: ou a troca entra antes
    // (e o encerramento recusa por jogo aberto), ou o fut encerra antes e o
    // re-check aqui recusa. Os erros daqui de dentro lançam e desfazem a
    // transação, como nas irmãs.
    const fut = await travarFut(tx, matchDayId);
    if (fut.status === "finished") {
      throw new ErroDaSumula("fut-encerrado");
    }

    // `for update` na linha do jogo, e não só o predicado no WHERE: é o que
    // serializa a troca contra o `lancarGol`, cujo incremento de placar é um
    // UPDATE nesta mesma linha. Sem ele, um gol tocado no mesmo instante leria
    // a escalação velha e nasceria com o lado errado.
    const [jogo] = await tx
      .select({ id: games.id, teamAId: games.teamAId, teamBId: games.teamBId })
      .from(games)
      .where(
        and(
          eq(games.id, gameId),
          // Escopo pelo fut: `gameId` vem do cliente.
          eq(games.matchDayId, matchDayId),
          isNotNull(games.startedAt),
          isNull(games.finishedAt),
        ),
      )
      .for("update");
    if (!jogo) throw new ErroDaSumula("jogo-nao-esta-aberto");

    const [escalado] = await tx
      .select({ side: gamePlayers.side })
      .from(gamePlayers)
      .where(and(eq(gamePlayers.gameId, gameId), eq(gamePlayers.playerId, playerId)));
    if (!escalado) throw new ErroDaSumula("jogador-fora-do-jogo");

    const de = escalado.side;
    const para = de === "A" ? ("B" as const) : ("A" as const);

    // Lado vazio é jogo que o encerramento recusa depois (`jogo-sem-time`, ver
    // confirmarEncerramento) — melhor barrar aqui, onde dá para dizer o que
    // aconteceu, do que travar o admin no fim do fut sem ele saber qual jogo.
    const [{ restam }] = await tx
      .select({ restam: sql<number>`count(*)::int` })
      .from(gamePlayers)
      .where(
        and(
          eq(gamePlayers.gameId, gameId),
          eq(gamePlayers.side, de),
          ne(gamePlayers.playerId, playerId),
        ),
      );
    if (restam === 0) throw new ErroDaSumula("jogo-sem-time");

    // O lado de origem no WHERE: se outro operador trocou esta mesma pessoa
    // entre a leitura e aqui, nenhuma linha volta e a transação desfaz tudo em
    // vez de gravar uma troca que já aconteceu. O erro diz isso — "dados
    // inválidos" soaria como bug do app para quem só perdeu a corrida.
    const [movido] = await tx
      .update(gamePlayers)
      .set({ side: para })
      .where(
        and(
          eq(gamePlayers.gameId, gameId),
          eq(gamePlayers.playerId, playerId),
          eq(gamePlayers.side, de),
        ),
      )
      .returning({ playerId: gamePlayers.playerId });
    if (!movido) throw new ErroDaSumula("troca-ja-feita");

    // O colete: sai de QUALQUER time deste fut e entra no do lado destino. O
    // delete amplo (e não um update do team_id) é o que conserta o caso em que
    // a escalação do jogo e o colete já divergiam — alguém escalado pelo
    // /encerrar num lado sem nunca ter tido linha de sorteio, por exemplo.
    const timesDoFut = await tx
      .select({ id: teams.id })
      .from(teams)
      .where(eq(teams.matchDayId, matchDayId));
    await tx
      .delete(teamPlayers)
      .where(
        and(
          eq(teamPlayers.playerId, playerId),
          inArray(
            teamPlayers.teamId,
            timesDoFut.map((t) => t.id),
          ),
        ),
      );
    await tx
      .insert(teamPlayers)
      .values({ teamId: para === "A" ? jogo.teamAId : jogo.teamBId, playerId })
      .onConflictDoNothing();

    await tx.insert(trocasDeLado).values({
      gameId,
      playerId,
      deLado: de,
      paraLado: para,
      createdByPlayerId: operador.session.player.id,
    });

    return { de, para };
  });
}

/** Carimba o fim do jogo em andamento — e devolve o placar final. */
export async function finalizarJogo(
  operador: OperadorDeSumula,
  params: { gameId: number },
): Promise<{ scoreA: number; scoreB: number }> {
  const matchDayId = operador.matchDay.id;
  const [finalizado] = await db
    .update(games)
    .set({ finishedAt: sql`now()` })
    .where(
      and(
        eq(games.id, params.gameId),
        eq(games.matchDayId, matchDayId),
        isNotNull(games.startedAt),
        isNull(games.finishedAt),
      ),
    )
    .returning({ id: games.id, scoreA: games.scoreA, scoreB: games.scoreB });
  if (!finalizado) throw new ErroDaSumula("jogo-nao-esta-aberto");
  return { scoreA: finalizado.scoreA, scoreB: finalizado.scoreB };
}
