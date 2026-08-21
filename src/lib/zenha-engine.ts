import "server-only";
import { and, asc, eq, gte, inArray, isNotNull, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import type { Executor } from "@/db";
import {
  attendances,
  gamePlayers,
  games,
  groupMembers,
  matchDays,
  ratingReports,
  ratingRoundRaters,
  ratingRounds,
  ratings,
  skillHistory,
  users,
  zenhaLedger,
} from "@/db/schema";
import { creditar } from "./carteira";
import { formatDateShort } from "./format";
import { devolverMultiplicadoresSemNota } from "./multiplicador-engine";
import { apurarMvp } from "./mvp";
import { notificar } from "./notifications";
import { getAgregadosMvp } from "./ratings";
import { notaParaCent } from "./skill";
import {
  ZENHA_DESDE,
  creditosDoFut,
  fechouSequencia,
  presencasSeguidas,
  type Ajustes,
  type FatosDoJogador,
  type FutDaSequencia,
} from "./zenha";
import { getAjustes } from "./zenha-config";

// A liquidação: onde a zenha de um fut é paga, uma vez só.
//
// ── Por que não sai no encerramento ────────────────────────────────────────
// Nenhuma das quatro fontes está pronta quando o admin encerra o fut. A nota e
// o MVP só existem depois que a rodada fecha; o placar e os gols continuam
// editáveis por JANELA_CORRECAO_HORAS; e uma denúncia aceita ainda pode
// descartar uma avaliação e mudar a nota de quem já teria sido pago. Pagar cedo
// exigiria estorno — e estorno é impossível num ledger append-only cujo dinheiro
// já pode ter virado badge.
//
// Então a liquidação espera o fut AMADURECER e paga sobre fato congelado. O
// preço é a zenha chegar um a dois dias depois do fut; o ganho é não existir
// nenhum código de desfazimento em lugar nenhum do sistema.
//
// ── Por que aqui e não em aplicarReplay ────────────────────────────────────
// `aplicarReplay` devolve o histórico do replay INTEIRO, de todas as rodadas de
// todos os tempos, e roda de novo a cada denúncia aceita e a cada fut apagado.
// Pendurar dinheiro nele seria reavaliar a história completa a cada evento.
// Aqui o recorte é um fut, uma vez.
//
// ── O exatamente-uma-vez ───────────────────────────────────────────────────
// Três camadas, e cada uma sozinha já seguraria o caso comum:
//   1. `UPDATE match_days SET liquidado_em = now() WHERE id = ? AND liquidado_em
//      IS NULL RETURNING` — o mesmo idioma do `fecharRodada`;
//   2. `unique(player_id, dedupe_key)` no ledger, que faz o insert repetido não
//      devolver linha e portanto não somar na carteira;
//   3. o advisory lock LOCK_NOTA, que o varredor já segura quando chama isto.

/**
 * Quantos futs para trás a sequência de presenças olha.
 *
 * Uma corrida mais longa que isto é impossível num grupo que joga por semana
 * (são dois anos), e o teto existe para a varredura não crescer com a história
 * do grupo. Se algum dia passar disso, a conta erra para MENOS — a sequência
 * parece começar no primeiro fut da janela —, que é o lado seguro.
 */
const JANELA_DA_SEQUENCIA = 100;

/**
 * Por quanto tempo um fut continua elegível à liquidação.
 *
 * Sem este corte, toda passada do varredor reexaminaria fut encerrado de dois
 * anos atrás. Com ele, o conjunto candidato é sempre pequeno e drena sozinho:
 * `liquidado_em` tira quem já foi pago, e a janela tira quem envelheceu demais.
 * Um fut que fique preso por mais de 30 dias (denúncia sem resolução, por
 * exemplo) simplesmente não paga — e não pagar é melhor que pagar errado.
 */
const JANELA_DE_LIQUIDACAO_DIAS = 30;

/**
 * Os futs prontos para pagar.
 *
 * "Maduro" é o coração da decisão: o fut encerrou, ainda não foi liquidado, é de
 * grupo, é posterior à estreia da economia, e — o que importa de verdade — ou
 * nunca teve rodada de avaliação, ou a rodada já fechou, o prazo de contestação
 * já venceu e não há nenhuma denúncia em aberto sobre ela.
 *
 * `finished_at` nulo cai fora pela comparação com a janela, e isso é
 * intencional: fut encerrado sem marco temporal (os anteriores a essa coluna)
 * não tem como provar que amadureceu.
 */
export async function futsALiquidar(exec: Executor): Promise<number[]> {
  const rodadaDoFut = eq(ratingRounds.matchDayId, matchDays.id);

  const semRodada = sql`not exists (
    select 1 from ${ratingRounds} where ${rodadaDoFut}
  )`;

  // A rodada fechou, o prazo de contestação venceu, e nenhuma denúncia daquela
  // rodada continua aberta. As três condições juntas são o que garante que a
  // nota lida aqui é a nota final.
  const rodadaMadura = sql`exists (
    select 1 from ${ratingRounds}
    where ${rodadaDoFut}
      and ${ratingRounds.status} = 'closed'
      and ${ratingRounds.reportDeadlineAt} is not null
      and ${ratingRounds.reportDeadlineAt} < now()
      and not exists (
        select 1 from ${ratingReports}
          join ${ratings} on ${ratings.id} = ${ratingReports.ratingId}
        where ${ratings.roundId} = ${ratingRounds.id}
          and ${ratingReports.status} = 'open'
      )
  )`;

  const linhas = await exec
    .select({ id: matchDays.id })
    .from(matchDays)
    .where(
      and(
        eq(matchDays.status, "finished"),
        isNull(matchDays.liquidadoEm),
        isNotNull(matchDays.groupId),
        gte(matchDays.date, ZENHA_DESDE),
        sql`${matchDays.finishedAt} > now() - make_interval(days => ${JANELA_DE_LIQUIDACAO_DIAS}::int)`,
        or(semRodada, rodadaMadura),
      ),
    )
    .orderBy(asc(matchDays.date), asc(matchDays.id));

  return linhas.map((l) => l.id);
}

/**
 * Paga um fut. Devolve quantas linhas de crédito entraram (0 quando outra
 * execução chegou antes, ou quando o fut não paga nada).
 *
 * Todas as leituras usam o `exec` recebido — nunca o `db` global. Quem chama
 * está dentro da transação do varredor, e uma query no pool global aqui
 * disputaria a conexão que a própria transação segura.
 */
export async function liquidarFut(
  exec: Executor,
  matchDayId: number,
  ajustes: Ajustes,
): Promise<number> {
  // A reivindicação vem antes de qualquer leitura: quem não conseguiu marcar
  // `liquidado_em` não tem o que fazer aqui, e sair cedo evita montar os fatos
  // de um fut que outra execução está pagando.
  // `group_id` não nulo entra na CONDIÇÃO do update, e não numa checagem depois
  // dele: carimbar `liquidado_em` num fut avulso o marcaria como pago sem pagar
  // nada, e o carimbo é definitivo. Hoje `futsALiquidar` já filtra os avulsos e
  // nunca entrega um; isto é a segunda camada, para um call site futuro que
  // chame `liquidarFut` direto não queimar o fut em silêncio.
  const [fut] = await exec
    .update(matchDays)
    .set({ liquidadoEm: sql`now()` })
    .where(
      and(
        eq(matchDays.id, matchDayId),
        isNull(matchDays.liquidadoEm),
        isNotNull(matchDays.groupId),
      ),
    )
    .returning({
      id: matchDays.id,
      date: matchDays.date,
      location: matchDays.location,
      groupId: matchDays.groupId,
    });
  if (!fut || fut.groupId === null) return 0;

  const [rodada] = await exec
    .select({ id: ratingRounds.id })
    .from(ratingRounds)
    .where(eq(ratingRounds.matchDayId, matchDayId));
  const roundId = rodada?.id ?? null;

  // Quem entrou em campo COM CONTA ATIVA. O innerJoin com `users` é o mesmo
  // filtro de todos os rankings (src/lib/stats.ts): quem joga sem conta conta
  // para placar e presença, mas não pontua em lugar nenhum — e não teria
  // carteira para receber.
  const emCampo = await exec
    .selectDistinct({ playerId: gamePlayers.playerId })
    .from(gamePlayers)
    .innerJoin(games, eq(games.id, gamePlayers.gameId))
    .innerJoin(users, and(eq(users.playerId, gamePlayers.playerId), eq(users.active, true)))
    .where(eq(games.matchDayId, matchDayId));

  const jogadores = emCampo.map((e) => e.playerId);
  if (jogadores.length === 0) return 0;

  // Antes de ler `skill_history`: quem armou o multiplicador e não foi avaliado
  // por ninguém recebe o item de volta. Este é o primeiro momento em que dá
  // para saber isso — no encerramento a rodada tinha acabado de abrir. O
  // delete também tira o fator do replay, o que é correto: um multiplicador
  // sobre uma rodada em que a nota do jogador não se moveu não faz nada.
  if (roundId !== null) {
    await devolverMultiplicadoresSemNota(exec, matchDayId, roundId);
  }

  const [raters, historico, vencedoresMvp, pagosNaSemana, sequencias] = await Promise.all([
    roundId === null
      ? Promise.resolve([])
      : exec
          .select({
            playerId: ratingRoundRaters.playerId,
            submittedAt: ratingRoundRaters.submittedAt,
            mvpPlayerId: ratingRoundRaters.mvpPlayerId,
          })
          .from(ratingRoundRaters)
          .where(eq(ratingRoundRaters.roundId, roundId)),
    roundId === null
      ? Promise.resolve([])
      : exec
          .select({
            playerId: skillHistory.playerId,
            antes: skillHistory.skillBefore,
            depois: skillHistory.skillAfter,
          })
          .from(skillHistory)
          .where(eq(skillHistory.roundId, roundId)),
    // A apuração sai da casa ÚNICA (getAgregadosMvp + apurarMvp), nunca de uma
    // query própria: o ranking de MVP deriva dos mesmos dois, e duas apurações
    // divergiriam no primeiro empate.
    roundId === null
      ? Promise.resolve<number[]>([])
      : getAgregadosMvp(exec, roundId).then(apurarMvp),
    contarFutsPagosNaSemana(exec, jogadores, matchDayId, fut.date),
    lerSequencias(exec, fut.groupId, matchDayId, fut.date, jogadores),
  ]);

  const porRater = new Map(raters.map((r) => [r.playerId, r]));
  const porHistorico = new Map(historico.map((h) => [h.playerId, h]));
  const vencedores = new Set(vencedoresMvp);

  const fatos: FatosDoJogador[] = jogadores.map((playerId) => {
    const rater = porRater.get(playerId);
    const hist = porHistorico.get(playerId);
    const seguidas = presencasSeguidas(sequencias.get(playerId) ?? []);
    return {
      playerId,
      jogou: true,
      eraRater: rater !== undefined,
      enviouAvaliacao: rater?.submittedAt != null,
      votouMvp: rater?.mvpPlayerId != null,
      // Em centésimos, que é a única unidade em que a comparação de nota
      // acontece neste sistema — comparar as notas em ponto flutuante traria de
      // volta a ambiguidade que o arredondamento de skill.ts existe para evitar.
      notaAntesCent: hist ? notaParaCent(hist.antes) : null,
      notaDepoisCent: hist ? notaParaCent(hist.depois) : null,
      vencedoresDoMvp: vencedores.has(playerId) ? vencedores.size : 0,
      fechouStreak: fechouSequencia(seguidas, ajustes),
      futsPagosNaSemana: pagosNaSemana.get(playerId) ?? 0,
    };
  });

  const linhas = creditosDoFut(
    {
      matchDayId,
      roundId,
      data: fut.date,
      ehDeGrupo: true,
      contasEmCampo: jogadores.length,
      // Com duas ou mais contas em campo, todo avaliador tinha em quem votar —
      // os candidatos são os outros que jogaram (ver getCandidatosMvp). Abaixo
      // disso o fut nem paga, mas a conta fica correta de qualquer jeito.
      haviaCandidatoMvp: jogadores.length > 1,
      descricaoDoFut: `fut de ${formatDateShort(fut.date)}, no ${fut.location}`,
      jogadores: fatos,
    },
    ajustes,
  );
  if (linhas.length === 0) return 0;

  await creditar(exec, linhas);

  // UM aviso por pessoa, com o total. Somar um aviso por fonte seriam até
  // quatro vibrações pelo mesmo fut — e toda linha em `notifications` é
  // candidata a push.
  const totalPorJogador = new Map<number, number>();
  for (const l of linhas) {
    totalPorJogador.set(l.playerId, (totalPorJogador.get(l.playerId) ?? 0) + l.amount);
  }
  await notificar(
    exec,
    [...totalPorJogador].map(([playerId, total]) => ({
      playerId,
      type: "zenha_creditada" as const,
      title: `Você ganhou ${total} zenhas`,
      body: `Pelo ${`fut de ${formatDateShort(fut.date)}`}. Toque para ver o extrato.`,
      href: "/zenhas",
      dedupeKey: `zenha:fut:${matchDayId}`,
    })),
  );

  return linhas.length;
}

/**
 * Quantos futs JÁ pagaram a cada jogador na semana deste fut.
 *
 * A semana é a do fut (`match_days.date`), não a do pagamento: a liquidação
 * acontece dias depois, e contar pela data do crédito colocaria dois futs da
 * mesma semana em semanas diferentes — ou o contrário. `date_trunc('week')` no
 * Postgres começa na segunda-feira.
 *
 * Conta `match_day_id` distintos, e não linhas: um fut paga até quatro fontes.
 */
async function contarFutsPagosNaSemana(
  exec: Executor,
  jogadores: number[],
  matchDayId: number,
  data: string,
): Promise<Map<number, number>> {
  const linhas = await exec
    .select({
      playerId: zenhaLedger.playerId,
      pagos: sql<number>`count(distinct ${zenhaLedger.matchDayId})::int`,
    })
    .from(zenhaLedger)
    .innerJoin(matchDays, eq(matchDays.id, zenhaLedger.matchDayId))
    .where(
      and(
        inArray(zenhaLedger.playerId, jogadores),
        ne(zenhaLedger.matchDayId, matchDayId),
        sql`date_trunc('week', ${matchDays.date}) = date_trunc('week', ${data}::date)`,
      ),
    )
    .groupBy(zenhaLedger.playerId);

  return new Map(linhas.map((l) => [l.playerId, l.pagos]));
}

/**
 * A sequência de cada jogador, terminando neste fut.
 *
 * Uma consulta para a lista de futs do grupo, uma para as presenças e uma para
 * as esperas — e a contagem em si é feita pela função pura `presencasSeguidas`.
 * Fazer isso em SQL exigiria uma janela por jogador; assim a regra fica no lugar
 * onde o teste unitário a alcança.
 *
 * Cada jogador só enxerga os futs a partir de quando ENTROU no grupo: sem esse
 * corte, entrar num grupo antigo começaria com uma sequência já quebrada por
 * futs que aconteceram antes de a pessoa existir ali.
 */
async function lerSequencias(
  exec: Executor,
  groupId: number,
  matchDayId: number,
  data: string,
  jogadores: number[],
): Promise<Map<number, FutDaSequencia[]>> {
  // Até este fut, inclusive. O desempate por id importa quando dois futs do
  // grupo caem no mesmo dia — sem ele a ordem mudaria entre execuções.
  const anteriores = await exec
    .select({ id: matchDays.id, date: matchDays.date })
    .from(matchDays)
    .where(
      and(
        eq(matchDays.groupId, groupId),
        eq(matchDays.status, "finished"),
        gte(matchDays.date, ZENHA_DESDE),
        lte(matchDays.date, data),
        or(lt(matchDays.date, data), lte(matchDays.id, matchDayId)),
      ),
    )
    .orderBy(asc(matchDays.date), asc(matchDays.id));

  // A janela conta do fim para o começo: o que interessa é a corrida que termina
  // neste fut, não o começo da história do grupo.
  const janela = anteriores.slice(-JANELA_DA_SEQUENCIA);
  const ids = janela.map((f) => f.id);
  if (ids.length === 0) return new Map();

  const [presencas, esperas, entradas] = await Promise.all([
    exec
      .selectDistinct({ matchDayId: games.matchDayId, playerId: gamePlayers.playerId })
      .from(gamePlayers)
      .innerJoin(games, eq(games.id, gamePlayers.gameId))
      .where(and(inArray(games.matchDayId, ids), inArray(gamePlayers.playerId, jogadores))),
    exec
      .select({ matchDayId: attendances.matchDayId, playerId: attendances.playerId })
      .from(attendances)
      .where(
        and(
          inArray(attendances.matchDayId, ids),
          inArray(attendances.playerId, jogadores),
          eq(attendances.status, "waitlist"),
        ),
      ),
    exec
      .select({
        playerId: groupMembers.playerId,
        // O dia da entrada é resolvido pelo POSTGRES, não por
        // `joinedAt.toISOString()` em JS. `joined_at` é `timestamp` sem fuso, e
        // o driver o devolve como `Date` interpretado no fuso do processo; o
        // `toISOString` reinterpretaria em UTC, e num runtime em UTC-3 uma
        // entrada gravada às 21h voltaria como o dia SEGUINTE — tirando da
        // sequência justamente o fut do dia em que a pessoa entrou no grupo.
        entrouEm: sql<string>`${groupMembers.joinedAt}::date`,
      })
      .from(groupMembers)
      .where(
        and(eq(groupMembers.groupId, groupId), inArray(groupMembers.playerId, jogadores)),
      ),
  ]);

  const presente = new Set(presencas.map((p) => `${p.matchDayId}:${p.playerId}`));
  const naEspera = new Set(esperas.map((e) => `${e.matchDayId}:${e.playerId}`));
  const desde = new Map(entradas.map((e) => [e.playerId, e.entrouEm ?? null]));

  const porJogador = new Map<number, FutDaSequencia[]>();
  for (const playerId of jogadores) {
    const entrou = desde.get(playerId) ?? null;
    porJogador.set(
      playerId,
      janela
        .filter((f) => entrou === null || f.date >= entrou)
        .map((f) => ({
          matchDayId: f.id,
          presente: presente.has(`${f.id}:${playerId}`),
          naEspera: naEspera.has(`${f.id}:${playerId}`),
        })),
    );
  }
  return porJogador;
}

/**
 * Liquida todos os futs maduros. Devolve quantos foram pagos.
 *
 * Os ajustes são lidos UMA vez por varredura: dois futs liquidados na mesma
 * passada valem o mesmo, e reler entre eles só abriria a porta para o admin
 * salvar o painel no meio e dois futs da mesma noite pagarem diferente.
 */
export async function liquidarFutsMaduros(exec: Executor): Promise<number> {
  const maduros = await futsALiquidar(exec);
  if (maduros.length === 0) return 0;

  const ajustes = await getAjustes(exec);
  let liquidados = 0;
  for (const matchDayId of maduros) {
    await liquidarFut(exec, matchDayId, ajustes);
    liquidados += 1;
  }
  return liquidados;
}
