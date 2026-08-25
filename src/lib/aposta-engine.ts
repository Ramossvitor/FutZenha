import "server-only";
import { and, asc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { db, type Executor } from "@/db";
import {
  attendances,
  gamePlayers,
  games,
  matchDays,
  ratingRounds,
  teams,
  trocasDeLado,
  zenhaApostas,
} from "@/db/schema";
import { dividirPote, timeDoApostador, vencedorDoFut, type ApostaEmDisputa } from "./aposta";
import { creditar, debitar } from "./carteira";
import { formatDateShort } from "./format";
import { FIM_DA_JANELA_CORRECAO } from "./janela-correcao";
import { BOLA_JA_ROLOU_HOJE, KICKOFF_DO_FUT } from "./kickoff";
import { notificar } from "./notifications";
import { getAjustes } from "./zenha-config";

// O motor da aposta: o que o módulo puro (src/lib/aposta.ts) decide, aqui vira
// escrita. A regra mora lá; o que mora aqui são os FATOS e as travas.
//
// Três coisas sustentam o antifraude deste arquivo, e nenhuma delas é a tela:
//
// 1. **A janela está no `WHERE` da escrita.** Quem decide se dá tempo de apostar
//    é o relógio do Postgres no instante do INSERT, nunca uma conta em
//    JavaScript feita antes. Não existe intervalo entre decidir e gravar para
//    alguém se enfiar.
// 2. **A mesma janela nas DUAS pontas.** Apostar e cancelar pedem exatamente o
//    mesmo predicado. É o ponto que o `desarmar` do multiplicador ensinou: sem
//    isso, aposta na sexta e cancela sábado à noite, depois de ver os times.
// 3. **O desfecho é escrito uma vez.** `UPDATE ... WHERE resolvida_em IS NULL
//    RETURNING` é o exatamente-uma-vez por linha, e é ele que impede a devolução
//    dupla quando o gancho do fut apagado cruza com a varredura.

/** Depois de quantos dias sem encerrar um fut conta como abandonado. */
const DIAS_PARA_FUT_ABANDONADO = 7;

/**
 * Por quanto tempo um fut continua elegível à liquidação das apostas. Mesma
 * razão do gêmeo em zenha-engine.ts: sem o corte, toda passada do varredor
 * reexaminaria fut encerrado de dois anos atrás.
 *
 * O corte só é seguro porque `devolverApostasDeFutsAbandonados` recolhe o que
 * ele deixa passar — o mesmo número aparece nos dois lugares de propósito, e é
 * o que faz os dois predicados ladrilharem em vez de deixar fresta. No gêmeo da
 * zenha isto não faz falta: lá, perder o prazo custa um bônus não pago; aqui,
 * custaria zenha que a pessoa já entregou.
 */
const JANELA_DE_LIQUIDACAO_DIAS = 30;

/**
 * A janela em que se aceita apostar (e cancelar).
 *
 * As três condições, e o que cada uma fecha:
 *
 * - **`status = 'scheduled'`** — definir os times FECHA a aposta. É o que a
 *   torna cega: quem aposta ainda não sabe com quem vai jogar, então não há
 *   informação a explorar na escolha. Note que isto é mais estreito que a janela
 *   do multiplicador, que aceita `teams_drawn`.
 * - **o buffer antes do kickoff** — `aposta_fecha_min_antes` minutos de margem,
 *   para o fut que começa adiantado sem ninguém ter lançado jogo nenhum.
 * - **`BOLA_JA_ROLOU_HOJE`** — a testemunha independente do relógio. Hoje ela é
 *   quase redundante (jogo exige `teams_drawn`, que já fecha a janela), e fica
 *   de propósito: ela custa nada e continua verdadeira se algum dia nascer jogo
 *   por outro caminho.
 *
 * Recebe a coluna do fut porque os chamadores chegam por caminhos diferentes:
 * pelo id da rota, ao apostar, e pelo `match_day_id` da própria aposta, ao
 * cancelar.
 */
const janelaDaAposta = (idDoFut: SQL, fechaMinAntes: number) => sql`exists (
  select 1 from ${matchDays}
  where ${matchDays.id} = ${idDoFut}
    and ${matchDays.status} = 'scheduled'
    and now() < ${KICKOFF_DO_FUT} - make_interval(mins => ${fechaMinAntes}::int)
    and not ${BOLA_JA_ROLOU_HOJE}
)`;

export type ErroDeAposta = "aposta-indisponivel" | "saldo-insuficiente";

/**
 * Registra a aposta e debita a zenha. Devolve o slug do erro, ou `null`.
 *
 * O INSERT é uma statement só, com todas as condições no próprio comando:
 * presença confirmada e janela aberta. Zero linhas é recusa — e não interessa
 * qual condição falhou, porque a tela já sabe o que ofereceu (mesmo desenho do
 * `armar`). O `on conflict do nothing` cobre a aposta repetida: o índice parcial
 * já garante uma ativa por fut, e deixar a exceção subir devolveria 500 para um
 * POST forjado em vez do redirect com o slug.
 *
 * O débito vem depois, e quando não há saldo a linha da aposta é APAGADA — ver o
 * comentário lá embaixo. Debitar e não registrar (ou registrar e não debitar) é
 * o único jeito de perder dinheiro aqui.
 */
export async function apostar(
  exec: Executor,
  playerId: number,
  matchDayId: number,
  valor: number,
): Promise<ErroDeAposta | null> {
  if (exec === db) {
    return db.transaction((tx) => apostarCom(tx, playerId, matchDayId, valor));
  }
  return apostarCom(exec, playerId, matchDayId, valor);
}

async function apostarCom(
  exec: Executor,
  playerId: number,
  matchDayId: number,
  valor: number,
): Promise<ErroDeAposta | null> {
  const ajustes = await getAjustes(exec);

  const inseridas = await exec.execute<{ id: number }>(sql`
      insert into ${zenhaApostas} (match_day_id, player_id, valor)
      select ${matchDayId}, ${playerId}, ${valor}
      where exists (
          select 1 from ${attendances}
          where ${attendances.matchDayId} = ${matchDayId}
            and ${attendances.playerId} = ${playerId}
            and ${attendances.status} = 'in'
        )
        and ${janelaDaAposta(sql`${matchDayId}`, ajustes.aposta_fecha_min_antes)}
      on conflict (match_day_id, player_id) where resolvida_em is null do nothing
      returning id
    `);

  const apostaId = inseridas[0]?.id;
  if (apostaId === undefined) return "aposta-indisponivel";

  const [fut] = await exec
    .select({ date: matchDays.date })
    .from(matchDays)
    .where(eq(matchDays.id, matchDayId));

  const saldo = await debitar(
    exec,
    playerId,
    valor,
    `aposta:${apostaId}`,
    `Aposta na sua vitória — ${descricaoDoFut(fut?.date)}`,
    { motivo: "aposta", matchDayId },
  );

  if (saldo === null) {
    // `debitar` não escreveu nada, mas o INSERT acima escreveu — e sem esta
    // linha a aposta ficaria de pé sem ter sido cobrada, que é a única forma de
    // ganhar dinheiro de graça neste arquivo.
    //
    // Apagar, e não lançar como faz a loja (src/lib/loja.ts): o `throw` de lá é
    // desfeito pelo rollback porque `comprar` SEMPRE abre a própria transação.
    // Aqui o `Executor` pode ser a transação de outra pessoa, e lançar levaria
    // junto tudo o que ela já tinha feito. O delete é exato — a linha acabou de
    // nascer nesta transação e ninguém mais a enxergou.
    await exec.delete(zenhaApostas).where(eq(zenhaApostas.id, apostaId));
    return "saldo-insuficiente";
  }

  return null;
}

/**
 * Cancela a aposta e devolve a zenha. Devolve o slug do erro, ou `null`.
 *
 * **A MESMA guarda de prazo do apostar** — ver o item 2 do cabeçalho. O
 * `player_id` no `WHERE` é o que impede cancelar aposta alheia com um id
 * forjado, e o `resolvida_em is null` é o que impede cancelar duas vezes.
 */
export async function cancelarAposta(
  exec: Executor,
  playerId: number,
  apostaId: number,
): Promise<"aposta-travada" | null> {
  if (exec === db) return db.transaction((tx) => cancelarApostaCom(tx, playerId, apostaId));
  return cancelarApostaCom(exec, playerId, apostaId);
}

async function cancelarApostaCom(
  exec: Executor,
  playerId: number,
  apostaId: number,
): Promise<"aposta-travada" | null> {
  const ajustes = await getAjustes(exec);

  const [cancelada] = await exec
    .update(zenhaApostas)
    .set({
      resolvidaEm: sql`now()`,
      retorno: sql`${zenhaApostas.valor}`,
      desfecho: "cancelada",
    })
    .where(
      and(
        eq(zenhaApostas.id, apostaId),
        eq(zenhaApostas.playerId, playerId),
        isNull(zenhaApostas.resolvidaEm),
        janelaDaAposta(sql`${zenhaApostas.matchDayId}`, ajustes.aposta_fecha_min_antes),
      ),
    )
    .returning({
      id: zenhaApostas.id,
      valor: zenhaApostas.valor,
      matchDayId: zenhaApostas.matchDayId,
    });

  if (!cancelada) return "aposta-travada";

  const [fut] = await exec
    .select({ date: matchDays.date })
    .from(matchDays)
    .where(eq(matchDays.id, cancelada.matchDayId));

  await creditar(exec, [
    {
      playerId,
      motivo: "aposta_devolvida",
      amount: cancelada.valor,
      dedupeKey: `aposta-devolvida:${cancelada.id}`,
      descricao: `Aposta cancelada — ${descricaoDoFut(fut?.date)}`,
      matchDayId: cancelada.matchDayId,
    },
  ]);

  return null;
}

/** O que a página do fut precisa para desenhar (ou esconder) o card. */
export type SituacaoDaAposta = {
  /** A aposta viva deste jogador neste fut. */
  minha: { id: number; valor: number } | null;
  /** O desfecho da última aposta dele aqui, quando já resolvida. */
  resolvida: {
    valor: number;
    retorno: number;
    desfecho: string;
    timeNome: string | null;
  } | null;
  /** Ele está na lista como confirmado — só quem joga aposta. */
  confirmado: boolean;
  /** A janela ainda aceita apostar e cancelar. */
  aceita: boolean;
  /** Tudo que está em jogo neste fut, somando as apostas vivas. */
  pote: number;
  apostaMin: number;
  apostaMax: number;
};

/**
 * A situação da aposta deste jogador neste fut.
 *
 * `aceita` sai do MESMO predicado que as actions usam, e não de uma conta em
 * JavaScript — enquanto a tela e a action tiverem cada uma a sua conta, uma
 * oferece o que a outra recusa. Ainda assim a tela é só a tela: o `WHERE` das
 * actions decide de novo, no instante da escrita.
 */
export async function situacaoDaAposta(
  exec: Executor,
  playerId: number,
  matchDayId: number,
): Promise<SituacaoDaAposta> {
  const ajustes = await getAjustes(exec);

  const [minhas, [fut], [potes]] = await Promise.all([
    exec
      .select({
        id: zenhaApostas.id,
        valor: zenhaApostas.valor,
        resolvidaEm: zenhaApostas.resolvidaEm,
        retorno: zenhaApostas.retorno,
        desfecho: zenhaApostas.desfecho,
        timeNome: zenhaApostas.timeNome,
      })
      .from(zenhaApostas)
      .where(and(eq(zenhaApostas.matchDayId, matchDayId), eq(zenhaApostas.playerId, playerId)))
      .orderBy(asc(zenhaApostas.id)),
    exec
      // Pelo id que veio da rota, e não por `matchDays.id` da linha externa: o
      // `from ${matchDays}` de dentro do exists sombrearia o de fora, e a
      // condição viraria `id = id` — verdadeira para qualquer fut.
      .select({
        aceita: sql<boolean>`${janelaDaAposta(sql`${matchDayId}`, ajustes.aposta_fecha_min_antes)}`,
        confirmado: sql<boolean>`exists (
          select 1 from ${attendances}
          where ${attendances.matchDayId} = ${matchDayId}
            and ${attendances.playerId} = ${playerId}
            and ${attendances.status} = 'in'
        )`,
      })
      .from(matchDays)
      .where(eq(matchDays.id, matchDayId)),
    exec
      .select({ total: sql<number>`coalesce(sum(${zenhaApostas.valor}), 0)::int` })
      .from(zenhaApostas)
      .where(and(eq(zenhaApostas.matchDayId, matchDayId), isNull(zenhaApostas.resolvidaEm))),
  ]);

  const viva = minhas.find((a) => a.resolvidaEm === null);
  // A CANCELADA não conta como desfecho a relatar, e é a exceção que sustenta a
  // aposta nova dentro da janela: a zenha já voltou e o banner já disse. Se ela
  // entrasse aqui, o card cairia no ramo do desfecho e sumiria com o formulário
  // — proibindo na tela exatamente a segunda aposta que a unique parcial de
  // `zenha_apostas_ativa_unq` foi desenhada para permitir.
  const ultimaResolvida = [...minhas]
    .reverse()
    .find((a) => a.resolvidaEm !== null && a.desfecho !== "cancelada");

  return {
    minha: viva ? { id: viva.id, valor: viva.valor } : null,
    resolvida:
      ultimaResolvida && ultimaResolvida.retorno !== null && ultimaResolvida.desfecho !== null
        ? {
            valor: ultimaResolvida.valor,
            retorno: ultimaResolvida.retorno,
            desfecho: ultimaResolvida.desfecho,
            timeNome: ultimaResolvida.timeNome,
          }
        : null,
    confirmado: fut?.confirmado ?? false,
    aceita: fut?.aceita ?? false,
    pote: potes?.total ?? 0,
    apostaMin: ajustes.aposta_min,
    apostaMax: ajustes.aposta_max,
  };
}

/**
 * Resolve como devolvidas todas as apostas vivas de um fut, e credita a zenha de
 * volta.
 *
 * O caminho único de toda devolução em massa: fut apagado e fut abandonado
 * passam por aqui. Idempotente por três vias — o `WHERE resolvida_em IS NULL`
 * do update, a unique de dedupe do ledger e a de `notifications`.
 */
export async function devolverApostasDoFut(
  exec: Executor,
  matchDayId: number,
  motivo: "fut-apagado" | "fut-abandonado",
): Promise<number> {
  // A data é lida ANTES do update: quem chama pelo `apagarFut` está a um
  // statement de o fut deixar de existir, e a descrição do extrato precisa
  // sobreviver a isso.
  const [fut] = await exec
    .select({ date: matchDays.date })
    .from(matchDays)
    .where(eq(matchDays.id, matchDayId));

  const devolvidas = await exec
    .update(zenhaApostas)
    .set({
      resolvidaEm: sql`now()`,
      retorno: sql`${zenhaApostas.valor}`,
      desfecho: "devolvida",
    })
    .where(and(eq(zenhaApostas.matchDayId, matchDayId), isNull(zenhaApostas.resolvidaEm)))
    .returning({
      id: zenhaApostas.id,
      playerId: zenhaApostas.playerId,
      valor: zenhaApostas.valor,
    });

  if (devolvidas.length === 0) return 0;

  // O texto do abandonado não diz "nunca foi encerrado": o mesmo caminho também
  // recolhe o fut que encerrou mas passou da janela de liquidação, e prometer o
  // motivo errado é pior que não prometer nenhum.
  const texto =
    motivo === "fut-apagado"
      ? "O fut foi apagado, então sua aposta voltou inteira."
      : "O fut não foi apurado no prazo, então sua aposta voltou inteira.";

  await creditar(
    exec,
    devolvidas.map((a) => ({
      playerId: a.playerId,
      motivo: "aposta_devolvida" as const,
      amount: a.valor,
      dedupeKey: `aposta-devolvida:${a.id}`,
      descricao: `Aposta devolvida — ${descricaoDoFut(fut?.date)}`,
      matchDayId,
    })),
  );

  await notificar(
    exec,
    devolvidas.map((a) => ({
      playerId: a.playerId,
      type: "aposta_devolvida" as const,
      title: `Sua aposta de ${a.valor} zenhas voltou`,
      body: texto,
      href: "/zenhas",
      dedupeKey: `aposta-devolvida:fut:${matchDayId}`,
    })),
  );

  return devolvidas.length;
}

/**
 * Devolve as apostas presas em futs que a liquidação nunca vai alcançar.
 *
 * Sem isto a zenha fica presa PARA SEMPRE: cancelar exige a janela, que fechou
 * no dia do fut. É o mesmo buraco que `soltarArmesDeFutsAbandonados` tapa para o
 * multiplicador, e o mesmo prazo.
 *
 * ── Por que a condição não é só `status <> 'finished'` ─────────────────────
 *
 * São DOIS os jeitos de um fut nunca ser liquidado, e este predicado tem que
 * LADRILHAR o que `apostasALiquidar` deixa de fora — se sobrar fresta entre os
 * dois, a aposta que cair nela não tem terceira saída:
 *
 * - **nunca encerrado** — a liquidação exige `finished`, que nunca vem;
 * - **encerrado tarde demais** — `apostasALiquidar` corta em
 *   JANELA_DE_LIQUIDACAO_DIAS, e fut encerrado que passou desse prazo sem ser
 *   liquidado (varredura fora do ar por semanas: o `after()` só faz
 *   `console.error`, então ela some em silêncio) sai do conjunto candidato e
 *   nunca mais volta. `finished_at` nulo entra pela mesma porta — sem marco não
 *   há como provar que está dentro da janela, e a comparação com ele seria NULL.
 *
 * A diferença para o gêmeo de zenha-engine.ts está aqui: lá, perder o prazo
 * custa um bônus não pago; aqui, custa zenha que a pessoa já entregou.
 */
export async function devolverApostasDeFutsAbandonados(exec: Executor): Promise<number> {
  const foraDoAlcanceDaLiquidacao = sql`(
    ${matchDays.status} <> 'finished'
    or ${matchDays.finishedAt} is null
    or ${matchDays.finishedAt} <= now() - make_interval(days => ${JANELA_DE_LIQUIDACAO_DIAS}::int)
  )`;

  const abandonados = await exec
    .selectDistinct({ id: matchDays.id })
    .from(matchDays)
    .innerJoin(zenhaApostas, eq(zenhaApostas.matchDayId, matchDays.id))
    .where(
      and(
        isNull(zenhaApostas.resolvidaEm),
        foraDoAlcanceDaLiquidacao,
        sql`now() > ${KICKOFF_DO_FUT} + make_interval(days => ${DIAS_PARA_FUT_ABANDONADO})`,
      ),
    );

  let devolvidas = 0;
  for (const fut of abandonados) {
    devolvidas += await devolverApostasDoFut(exec, fut.id, "fut-abandonado");
  }
  return devolvidas;
}

/**
 * Os futs com aposta pronta para resolver.
 *
 * O critério é mais exigente que o da zenha (`futsALiquidar`), e a diferença é o
 * ponto: a aposta paga por PLACAR, e placar continua editável por
 * JANELA_CORRECAO_HORAS depois do encerramento. Esperar `FIM_DA_JANELA_CORRECAO`
 * é o que transforma a janela de correção que já existia na confirmação coletiva
 * do resultado — quem apostou tem 24h para apontar um placar errado ANTES de o
 * dinheiro se mover, e é isso que segura um admin que aposte no próprio fut.
 *
 * A rodada de avaliação fechada entra pela mesma razão de sempre: enquanto ela
 * corre o fut ainda pode virar denúncia, e resolver aposta no meio disso seria
 * pagar sobre um fut em disputa.
 *
 * Fut sem aposta viva nunca entra — é o que faz o conjunto candidato drenar
 * sozinho, junto com `apostas_liquidadas_em`.
 */
export async function apostasALiquidar(exec: Executor): Promise<number[]> {
  const rodadaDoFut = eq(ratingRounds.matchDayId, matchDays.id);

  const semRodada = sql`not exists (
    select 1 from ${ratingRounds} where ${rodadaDoFut}
  )`;

  const rodadaFechada = sql`exists (
    select 1 from ${ratingRounds}
    where ${rodadaDoFut} and ${ratingRounds.status} = 'closed'
  )`;

  const linhas = await exec
    .select({ id: matchDays.id })
    .from(matchDays)
    .where(
      and(
        eq(matchDays.status, "finished"),
        isNull(matchDays.apostasLiquidadasEm),
        sql`now() > ${FIM_DA_JANELA_CORRECAO}`,
        sql`${matchDays.finishedAt} > now() - make_interval(days => ${JANELA_DE_LIQUIDACAO_DIAS}::int)`,
        sql`(${semRodada} or ${rodadaFechada})`,
        sql`exists (
          select 1 from ${zenhaApostas}
          where ${zenhaApostas.matchDayId} = ${matchDays.id}
            and ${zenhaApostas.resolvidaEm} is null
        )`,
      ),
    )
    .orderBy(asc(matchDays.date), asc(matchDays.id));

  return linhas.map((l) => l.id);
}

/** Resolve as apostas de todos os futs prontos. Devolve quantas foram resolvidas. */
export async function liquidarApostasProntas(exec: Executor): Promise<number> {
  const futs = await apostasALiquidar(exec);
  let resolvidas = 0;
  for (const matchDayId of futs) {
    resolvidas += await liquidarApostasDoFut(exec, matchDayId);
  }
  return resolvidas;
}

/**
 * Resolve as apostas de um fut. Devolve quantas linhas foram resolvidas (0
 * quando outra execução chegou antes).
 *
 * Todas as leituras usam o `exec` recebido — nunca o `db` global: quem chama
 * está dentro da transação do varredor, e uma query no pool global disputaria a
 * conexão que a própria transação segura.
 */
export async function liquidarApostasDoFut(exec: Executor, matchDayId: number): Promise<number> {
  // A reivindicação vem antes de qualquer leitura, como na liquidação da zenha:
  // quem não conseguiu carimbar não tem o que fazer aqui.
  const [fut] = await exec
    .update(matchDays)
    .set({ apostasLiquidadasEm: sql`now()` })
    .where(and(eq(matchDays.id, matchDayId), isNull(matchDays.apostasLiquidadasEm)))
    .returning({ id: matchDays.id, date: matchDays.date });
  if (!fut) return 0;

  const apostas = await exec
    .select({
      id: zenhaApostas.id,
      playerId: zenhaApostas.playerId,
      valor: zenhaApostas.valor,
    })
    .from(zenhaApostas)
    .where(and(eq(zenhaApostas.matchDayId, matchDayId), isNull(zenhaApostas.resolvidaEm)))
    .orderBy(asc(zenhaApostas.id));
  if (apostas.length === 0) return 0;

  const apostadores = apostas.map((a) => a.playerId);

  const [jogos, escalacoes, trocas, times] = await Promise.all([
    exec
      .select({
        teamAId: games.teamAId,
        teamBId: games.teamBId,
        scoreA: games.scoreA,
        scoreB: games.scoreB,
      })
      .from(games)
      .where(eq(games.matchDayId, matchDayId))
      .orderBy(asc(games.sortOrder), asc(games.id)),
    // O time de cada apostador em cada jogo, pelo snapshot: `side` é o lado
    // congelado na criação do jogo, e é ele — não `team_players`, que a troca
    // reescreve — que diz por quem a pessoa jogou naquele momento.
    exec
      .select({
        playerId: gamePlayers.playerId,
        teamId: sql<number>`case when ${gamePlayers.side} = 'A'
          then ${games.teamAId} else ${games.teamBId} end`,
      })
      .from(gamePlayers)
      .innerJoin(games, eq(games.id, gamePlayers.gameId))
      .where(and(eq(games.matchDayId, matchDayId), inArray(gamePlayers.playerId, apostadores)))
      .orderBy(asc(games.sortOrder), asc(games.id)),
    exec
      .selectDistinct({ playerId: trocasDeLado.playerId })
      .from(trocasDeLado)
      .innerJoin(games, eq(games.id, trocasDeLado.gameId))
      .where(and(eq(games.matchDayId, matchDayId), inArray(trocasDeLado.playerId, apostadores))),
    exec
      .select({ id: teams.id, name: teams.name })
      .from(teams)
      .where(eq(teams.matchDayId, matchDayId)),
  ]);

  const vencedor = vencedorDoFut(jogos);
  const trocaram = new Set(trocas.map((t) => t.playerId));
  const nomeDoTime = new Map(times.map((t) => [t.id, t.name]));

  const timesPorJogador = new Map<number, number[]>();
  for (const linha of escalacoes) {
    const lista = timesPorJogador.get(linha.playerId) ?? [];
    lista.push(linha.teamId);
    timesPorJogador.set(linha.playerId, lista);
  }

  // Quem disputa de verdade vai para o pote; o resto é devolvido sem entrar na
  // divisão — devolver nunca paga mais do que se apostou, então nenhum desses
  // caminhos vira lucro.
  const emDisputa: ApostaEmDisputa[] = [];
  const timeDaAposta = new Map<number, number>();
  const devolver: number[] = [];

  for (const aposta of apostas) {
    const time = timeDoApostador(timesPorJogador.get(aposta.playerId) ?? [], trocaram.has(aposta.playerId));
    if (time === "nao-jogou" || time === "trocou-de-time" || vencedor === null) {
      devolver.push(aposta.id);
      continue;
    }
    timeDaAposta.set(aposta.id, time.teamId);
    emDisputa.push({
      apostaId: aposta.id,
      valor: aposta.valor,
      vencedora: time.teamId === vencedor,
    });
  }

  const desfechos = [
    ...dividirPote(emDisputa),
    ...devolver.map((apostaId) => ({
      apostaId,
      retorno: apostas.find((a) => a.id === apostaId)?.valor ?? 0,
      desfecho: "devolvida" as const,
    })),
  ];

  const porId = new Map(apostas.map((a) => [a.id, a]));
  const creditos = [];
  const avisos = [];

  for (const d of desfechos) {
    const aposta = porId.get(d.apostaId);
    if (!aposta) continue;
    const timeId = timeDaAposta.get(d.apostaId);
    const timeNome = timeId === undefined ? null : (nomeDoTime.get(timeId) ?? null);

    // Terceira camada do exatamente-uma-vez, depois do carimbo no fut e da
    // unique de dedupe do ledger.
    const [gravada] = await exec
      .update(zenhaApostas)
      .set({
        resolvidaEm: sql`now()`,
        retorno: d.retorno,
        desfecho: d.desfecho,
        timeNome,
      })
      .where(and(eq(zenhaApostas.id, d.apostaId), isNull(zenhaApostas.resolvidaEm)))
      .returning({ id: zenhaApostas.id });
    if (!gravada) continue;

    if (d.retorno > 0) {
      const paga = d.desfecho === "paga";
      creditos.push({
        playerId: aposta.playerId,
        motivo: paga ? ("premio_aposta" as const) : ("aposta_devolvida" as const),
        amount: d.retorno,
        dedupeKey: paga ? `premio-aposta:${d.apostaId}` : `aposta-devolvida:${d.apostaId}`,
        descricao: paga
          ? `Prêmio da aposta${timeNome ? ` (${timeNome})` : ""} — ${descricaoDoFut(fut.date)}`
          : `Aposta devolvida — ${descricaoDoFut(fut.date)}`,
        matchDayId,
      });
    }

    avisos.push(
      d.desfecho === "devolvida"
        ? {
            playerId: aposta.playerId,
            type: "aposta_devolvida" as const,
            title: `Sua aposta de ${aposta.valor} zenhas voltou`,
            body: "Ninguém venceu o fut, ou você não disputou pelo time em que apostou.",
            href: "/zenhas",
            dedupeKey: `aposta-devolvida:fut:${matchDayId}`,
          }
        : d.desfecho === "paga"
          ? {
              playerId: aposta.playerId,
              type: "aposta_resolvida" as const,
              title: `Você ganhou a aposta: ${d.retorno} zenhas`,
              body: `Apostou ${aposta.valor} e venceu o ${descricaoDoFut(fut.date)}.`,
              href: "/zenhas",
              dedupeKey: `aposta:fut:${matchDayId}`,
            }
          : {
              playerId: aposta.playerId,
              type: "aposta_resolvida" as const,
              title: `Você perdeu a aposta: ${aposta.valor} zenhas`,
              body: `Seu time não venceu o ${descricaoDoFut(fut.date)}.`,
              href: "/zenhas",
              dedupeKey: `aposta:fut:${matchDayId}`,
            },
    );
  }

  if (creditos.length > 0) await creditar(exec, creditos);
  await notificar(exec, avisos);

  return avisos.length;
}

/** O fut como ele aparece no extrato — congelado, porque a linha sobrevive a ele. */
function descricaoDoFut(date: string | undefined): string {
  return date ? `fut de ${formatDateShort(date)}` : "fut";
}
