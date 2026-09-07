import "server-only";
import { and, asc, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { gamePlayers, games, goals, players, teams } from "@/db/schema";
import { listarFutsOperaveis } from "@/lib/futs-operaveis";
import { resolverMensagem } from "@/lib/mensagens";
import { operadorDeSumula, type OperadorDeSumula } from "@/lib/require-operador-sumula";
import { sessaoPorToken } from "@/lib/sessao-por-token";
import type { Session } from "@/lib/session";
import { sumulaDisponivel } from "@/lib/sumula";
import { escolherFutParaOperar, lerInteiro } from "@/lib/sumula-relogio";
import { ErroDaSumula } from "@/lib/sumula-servico";

// O que as rotas de /api/sumula têm em comum: quem é (o token), qual fut (a
// escolha que o relógio não digita), e o formato das respostas.
//
// Tudo com `Request`/`Response` puros, e não NextRequest/NextResponse, como no
// webhook do Mercado Pago: as rotas não usam nada que só o wrapper dá, e é o
// par puro que o teste de integração consegue construir (o harness mocka
// next/server).
//
// Os slugs de erro são os de src/lib/mensagens.ts, e chamar `respostaDeErro`
// com o slug em string literal é a forma que mensagens.test.ts varre — cada
// slug que só a API emite precisa aparecer assim em algum arquivo daqui.

/**
 * O status HTTP de cada recusa. O default é 409: quase toda recusa da súmula é
 * "o estado do jogo não é o que o toque supôs" — jogo já aberto, já
 * finalizado, gol já desfeito, troca já feita —, e é isso que 409 quer dizer.
 * Os três abaixo são as exceções com nome próprio.
 */
const STATUS_POR_SLUG: Record<string, number> = {
  "dados-invalidos": 400,
  "token-invalido": 401,
  "sem-fut-para-operar": 404,
};

// Resposta de API autenticada nunca entra em cache de nada — nem do atalho.
const CABECALHOS = { "cache-control": "no-store" };

export function respostaDeErro(slug: string, extra: Record<string, unknown> = {}): Response {
  return Response.json(
    // `?? slug`: um slug sem mensagem é bug que o teste pega; aqui só se garante
    // que a resposta nunca sai sem texto.
    { erro: slug, mensagem: resolverMensagem(slug) ?? slug, ...extra },
    { status: STATUS_POR_SLUG[slug] ?? 409, headers: CABECALHOS },
  );
}

export function respostaOk(corpo: Record<string, unknown>): Response {
  return Response.json({ ok: true, ...corpo }, { headers: CABECALHOS });
}

export type Corpo = Record<string, unknown>;

/**
 * O corpo JSON do POST. Vazio é `{}` — o atalho "Novo jogo" não manda nada —;
 * JSON quebrado ou que não é objeto é `null`, e vira 400 em quem chamou.
 */
export async function lerCorpo(request: Request): Promise<Corpo | null> {
  const texto = await request.text();
  if (texto.trim() === "") return {};
  try {
    const json: unknown = JSON.parse(texto);
    return typeof json === "object" && json !== null && !Array.isArray(json)
      ? (json as Corpo)
      : null;
  } catch {
    return null;
  }
}

/**
 * De quem é o token, e qual fut ele está operando — a parte que toda rota
 * repete, com a tradução do `ErroDaSumula` em resposta no fim.
 *
 * O `fut` opcional (ver `lerFutForcado`) força um fut; sem ele, a escolha é de
 * `escolherFutParaOperar` sobre a lista de futs operáveis. Em qualquer dos dois
 * caminhos a autoridade é `operadorDeSumula`: a lista é pré-filtro, e o guard
 * é reexecutado no fut escolhido.
 */
export async function comOperador(
  request: Request,
  executar: (operador: OperadorDeSumula, corpo: Corpo) => Promise<Response>,
): Promise<Response> {
  const session = await sessaoPorToken(request.headers.get("authorization"));
  if (!session) return respostaDeErro("token-invalido");

  const corpo = request.method === "GET" ? {} : await lerCorpo(request);
  if (corpo === null) return respostaDeErro("dados-invalidos");

  const fut = lerFutForcado(request, corpo);
  if (!fut.ok) return respostaDeErro("dados-invalidos");

  const resolvido = await resolverOperador(session, fut.valor);
  if ("resposta" in resolvido) return resolvido.resposta;

  try {
    return await executar(resolvido.operador, corpo);
  } catch (erro) {
    if (erro instanceof ErroDaSumula) return respostaDeErro(erro.slug);
    throw erro;
  }
}

/**
 * O `fut` forçado: na query string em QUALQUER método — é a URL do GET que a
 * pessoa copia para montar o POST, e um `?fut=` ignorado em silêncio lançaria
 * gol no fut da escolha automática — ou no corpo do POST. Os dois ao mesmo
 * tempo só valem se disserem o mesmo; divergência é pedido contraditório.
 */
function lerFutForcado(
  request: Request,
  corpo: Corpo,
): { ok: true; valor: number | null } | { ok: false } {
  const naQuery = lerInteiro(new URL(request.url).searchParams.get("fut"));
  const noCorpo = lerInteiro(corpo.fut);
  if (!naQuery.ok || !noCorpo.ok) return { ok: false };
  if (naQuery.valor !== null && noCorpo.valor !== null && naQuery.valor !== noCorpo.valor) {
    return { ok: false };
  }
  return { ok: true, valor: naQuery.valor ?? noCorpo.valor };
}

async function resolverOperador(
  session: Session,
  futForcado: number | null,
): Promise<{ operador: OperadorDeSumula } | { resposta: Response }> {
  if (futForcado !== null) {
    // Fut inexistente e fut alheio dão a mesma resposta, como no guard: quem
    // não opera não precisa saber que o id existe.
    const operador = await operadorDeSumula(session, futForcado);
    if (!operador) return { resposta: respostaDeErro("sem-fut-para-operar") };
    // Forçado, o fut pode estar fora da janela da súmula — e aí a resposta diz
    // qual é o problema, porque quem opera tem o direito de saber.
    if (operador.matchDay.status === "finished") {
      return { resposta: respostaDeErro("fut-encerrado") };
    }
    if (!sumulaDisponivel(operador.matchDay)) {
      return { resposta: respostaDeErro("sumula-indisponivel") };
    }
    return { operador };
  }

  const escolha = escolherFutParaOperar(await listarFutsOperaveis(session));
  if (escolha.tipo === "nenhum") return { resposta: respostaDeErro("sem-fut-para-operar") };
  if (escolha.tipo === "varios") {
    return {
      resposta: respostaDeErro("varios-futs", {
        candidatos: escolha.candidatos.map((c) => ({ id: c.id, data: c.date, local: c.location })),
      }),
    };
  }

  const operador = await operadorDeSumula(session, escolha.fut.id);
  // A lista e o guard concordam por construção (ver futs-operaveis.ts); se um
  // dia divergirem, a resposta é a de "nenhum" — nunca operar sem o guard.
  if (!operador) return { resposta: respostaDeErro("sem-fut-para-operar") };
  return { operador };
}

export type JogoAberto = {
  id: number;
  scoreA: number;
  scoreB: number;
  timeA: string;
  timeB: string;
  /** Contado pelo Postgres, como no painel (sumula/dados.ts): sem relógio da aplicação. */
  segundosEmAndamento: number;
};

/** O jogo em andamento do fut, com os nomes dos times — ou null. */
export async function jogoAbertoDoFut(matchDayId: number): Promise<JogoAberto | null> {
  const timeA = alias(teams, "time_a");
  const timeB = alias(teams, "time_b");
  const [jogo] = await db
    .select({
      id: games.id,
      scoreA: games.scoreA,
      scoreB: games.scoreB,
      timeA: timeA.name,
      timeB: timeB.name,
      segundosEmAndamento: sql<number>`extract(epoch from (now() - ${games.startedAt}))::int`,
    })
    .from(games)
    .innerJoin(timeA, eq(timeA.id, games.teamAId))
    .innerJoin(timeB, eq(timeB.id, games.teamBId))
    .where(
      and(eq(games.matchDayId, matchDayId), isNotNull(games.startedAt), isNull(games.finishedAt)),
    );
  return jogo ?? null;
}

/** Os dois primeiros times do fut, na ordem do sorteio — o default de "Novo jogo". */
export async function doisPrimeirosTimes(matchDayId: number): Promise<number[]> {
  const linhas = await db
    .select({ id: teams.id })
    .from(teams)
    .where(eq(teams.matchDayId, matchDayId))
    .orderBy(asc(teams.sortOrder), asc(teams.id))
    .limit(2);
  return linhas.map((t) => t.id);
}

export type Escalado = { playerId: number; nome: string; apelido: string | null };

/** Quem está de um lado do jogo — o universo do autor do gol e da troca. */
export async function escalacaoDoLado(gameId: number, side: "A" | "B"): Promise<Escalado[]> {
  return db
    .select({ playerId: gamePlayers.playerId, nome: players.name, apelido: players.nickname })
    .from(gamePlayers)
    .innerJoin(players, eq(players.id, gamePlayers.playerId))
    .where(and(eq(gamePlayers.gameId, gameId), eq(gamePlayers.side, side)))
    .orderBy(asc(players.name));
}

/**
 * O último gol ATIVO da súmula de um lado do jogo — o alvo do "Desfazer A" do
 * relógio, que não tem id de gol na mão. O mesmo universo do painel:
 * `somado_no_placar` (só o que a súmula lançou) e não desfeito.
 */
export async function ultimoGolDoLado(gameId: number, side: "A" | "B"): Promise<number | null> {
  const [gol] = await db
    .select({ id: goals.id })
    .from(goals)
    .where(
      and(
        eq(goals.gameId, gameId),
        eq(goals.side, side),
        eq(goals.somadoNoPlacar, true),
        isNull(goals.desfeitoEm),
      ),
    )
    .orderBy(desc(goals.id))
    .limit(1);
  return gol?.id ?? null;
}

/** Apelido, ou nome — o mesmo rótulo do painel. */
export function rotuloDe(jogador: { nome: string; apelido: string | null }): string {
  return jogador.apelido ?? jogador.nome;
}
