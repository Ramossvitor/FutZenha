import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, type Executor } from "@/db";
import { attendances, matchDays, users } from "@/db/schema";
import { ehElegivel, type EscopoDaLista } from "./elegiveis";
import { formatDate } from "./format";
import {
  listaFechada,
  ordenarPorChegada,
  proximoDaEspera,
  statusAoConfirmar,
  type LinhaDaLista,
} from "./lista-presenca";
import type { NovaNotificacao } from "./notifications";
import { podeDefinirPresencaPor } from "./permissions";
import type { Session } from "./session";

/**
 * Os três fatos que decidem se alguém pode ser marcado por outra pessoa nesta
 * fut. A regra em si é pura e mora em src/lib/permissions.ts.
 */
export type AlvoDePresenca = {
  temContaAtiva: boolean;
  jaEstaNoFut: boolean;
  elegivel: boolean;
};

async function situacaoDoAlvo(
  matchDay: EscopoDaLista,
  playerId: number,
): Promise<AlvoDePresenca> {
  const [conta] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.playerId, playerId), eq(users.active, true)));
  const [presenca] = await db
    .select({ playerId: attendances.playerId })
    .from(attendances)
    .where(and(eq(attendances.matchDayId, matchDay.id), eq(attendances.playerId, playerId)));

  return {
    temContaAtiva: conta !== undefined,
    jaEstaNoFut: presenca !== undefined,
    elegivel: await ehElegivel(matchDay, playerId),
  };
}

/**
 * Se esta sessão pode mexer na presença/escalação deste jogador neste fut.
 *
 * Consultado pelas actions que recebem `playerId` do cliente — a tela só
 * oferece quem faz sentido, mas Server Action é endpoint público e não passa
 * pelo proxy (node_modules/next/dist/docs/01-app/02-guides/data-security.md).
 *
 * Recebe o `matchDay`, e não só o id, porque a regra passou a depender do escopo
 * (grupo ou avulsa) e de a lista estar fechada — dois fatos que quem chama já
 * tem em mãos pelo `requireFutAdmin`, e que ler de novo aqui seria round-trip
 * a mais na rota mais pesada do app.
 */
export async function avaliarMarcacao(
  session: Session,
  matchDay: EscopoDaLista & { status: "scheduled" | "teams_drawn" | "finished" },
  playerId: number,
): Promise<{ permitido: boolean; alvo: AlvoDePresenca }> {
  const ator = { playerId: session.player.id, isPlatformAdmin: session.isPlatformAdmin };
  const alvo = await situacaoDoAlvo(matchDay, playerId);
  // Marcar por si mesmo é sempre permitido: é o caso normal de quem organiza a
  // próprio fut e confirma a própria presença pela tela de gestão.
  const permitido =
    playerId === session.player.id ||
    podeDefinirPresencaPor(ator, alvo, {
      listaFechada: listaFechada(matchDay.status),
      // Fut avulso não tem grupo, e portanto não tem consentimento a invocar —
      // ver podeDefinirPresencaPor. O escopo sai do `matchDay` que o guard já
      // leu do banco, nunca de um id vindo do cliente.
      ehDeGrupo: matchDay.groupId !== null,
    });
  return { permitido, alvo };
}

/**
 * Se incluir esta pessoa é novidade para ela — e portanto merece aviso.
 *
 * Quem não tem conta não tem onde receber o aviso, e quem já estava no fut
 * sabe que está nela. Sobra exatamente o caso que a exceção da lista fechada
 * abriu: alguém com conta sendo posto no fut por outra pessoa.
 */
export function mereceAviso(session: Session, playerId: number, alvo: AlvoDePresenca): boolean {
  return playerId !== session.player.id && alvo.temContaAtiva && !alvo.jaEstaNoFut;
}

/**
 * O aviso de quem subiu da espera para uma vaga. Sai daqui para as três portas
 * de promoção (sair da lista, admin marcando "Fora", limite de vagas maior)
 * avisarem a mesma coisa — a promoção acontece sozinha, e sem aviso a pessoa
 * descobriria que "vai" só olhando a página de novo.
 */
export function avisoDePromocao(
  matchDay: { id: number; date: string; location: string },
  playerId: number,
): NovaNotificacao {
  return {
    playerId,
    type: "pelada_presenca_definida",
    title: "Abriu vaga: você está na lista",
    body: `Você saiu da espera e entrou na lista do fut de ${formatDate(matchDay.date)}, em ${matchDay.location}.`,
    href: `/fut/${matchDay.id}`,
    dedupeKey: `espera-promovido:${matchDay.id}:${playerId}`,
  };
}

// ---------------------------------------------------------------------------
// Mexer na lista
//
// As operações abaixo são o único caminho para mexer em quem está na lista — a
// página pública, o painel do admin e o cadastro de convidado passam todas por
// aqui. Concentrar isso importa porque o corte das vagas e a promoção da espera
// são fáceis de esquecer num call site: um upsert distraído de `status: "in"`
// fura o limite sem que nada acuse.
//
// Todas exigem estar dentro de uma transação de quem chama, e é por isso que
// recebem `Executor` em vez de usarem o `db` direto: contar as vagas e gravar
// não podem ficar em janelas separadas.
// ---------------------------------------------------------------------------

export type FutTravado = {
  status: "scheduled" | "teams_drawn" | "finished";
  maxPlayers: number | null;
};

/**
 * Serializa as mexidas na lista deste fut — e devolve os fatos frescos.
 *
 * Sem o lock, duas pessoas confirmando ao mesmo tempo leem "1 vaga ocupada" e as
 * duas entram como vaga num fut de 2 — o `unique(match_day_id, player_id)`
 * não pega, porque são jogadores diferentes. Travar a linha do fut é o ponto
 * de serialização mais barato: já é a linha que todo mundo nesta transação lê.
 *
 * Devolver `status` e `maxPlayers` não é cortesia: o snapshot de quem chama é
 * pré-transação, e decidir com ele reabriria a janela que o lock fecha — um
 * "Vou" concorrendo com o sorteio entraria numa lista que acabou de fechar.
 */
export async function travarFut(exec: Executor, matchDayId: number): Promise<FutTravado> {
  const [fut] = await exec
    .select({ status: matchDays.status, maxPlayers: matchDays.maxPlayers })
    .from(matchDays)
    .where(eq(matchDays.id, matchDayId))
    .for("update");
  if (!fut) throw new Error(`Fut ${matchDayId} não existe mais.`);
  return fut;
}

// Encerrada, a escalação e a presença são imutáveis. Quem chega aqui com uma
// fut `finished` passou numa guarda pré-transação que o encerramento
// atropelou no meio do caminho — abortar a transação é o único acerto.
function exigirNaoEncerrada(fut: FutTravado, matchDayId: number): void {
  if (fut.status === "finished") {
    throw new Error(`Fut ${matchDayId} foi encerrado no meio da operação.`);
  }
}

async function linhasDaLista(exec: Executor, matchDayId: number): Promise<LinhaDaLista[]> {
  return exec
    .select({
      playerId: attendances.playerId,
      status: attendances.status,
      confirmedAt: attendances.confirmedAt,
    })
    .from(attendances)
    .where(eq(attendances.matchDayId, matchDayId));
}

export type ResultadoDeEntrada = {
  /** Situação anterior — nulo para quem nunca esteve na lista deste fut. */
  de: "in" | "out" | "waitlist" | "no_show" | null;
  para: "in" | "waitlist";
};

/**
 * Põe alguém na lista — como vaga ou como espera, quem decide é a linha travada.
 *
 * Com a lista fechada não existe mais fila. Quem inclui alguém ali é o admin,
 * olhando para a quadra, e mandar para a espera quem já está em campo seria
 * teimosia do sistema contra o fato.
 *
 * `confirmedAt` é preservado quando já existe: reconfirmar quem já está na lista
 * (a tela é idempotente) não pode mandar a pessoa para o fim da fila. Quem passou
 * por `sairDaLista` teve o marco zerado e entra no fim mesmo — é o combinado de
 * quem desiste e volta atrás.
 *
 * Devolve de onde para onde a pessoa foi: só a transição para vaga é evento
 * novo de agenda, e reconfirmar quem já está `in` não pode virar e-mail.
 */
export async function entrarNaLista(
  exec: Executor,
  matchDayId: number,
  playerId: number,
): Promise<ResultadoDeEntrada> {
  const fut = await travarFut(exec, matchDayId);
  exigirNaoEncerrada(fut, matchDayId);
  const linhas = await linhasDaLista(exec, matchDayId);
  const atual = linhas.find((l) => l.playerId === playerId);

  const ocupadas = linhas.filter((l) => l.status === "in" && l.playerId !== playerId).length;
  const status = listaFechada(fut.status)
    ? "in"
    : statusAoConfirmar(ocupadas, fut.maxPlayers);
  const confirmedAt = atual?.confirmedAt ?? new Date();

  await exec
    .insert(attendances)
    .values({ matchDayId, playerId, status, confirmedAt })
    .onConflictDoUpdate({
      target: [attendances.matchDayId, attendances.playerId],
      set: {
        status,
        confirmedAt,
        updatedAt: new Date(),
        // Toda transição versiona o evento de agenda (ver calendar_sequence
        // no schema) — quem lê é src/lib/agenda-convite.ts.
        calendarSequence: sql`${attendances.calendarSequence} + 1`,
      },
    });
  return { de: atual?.status ?? null, para: status };
}

export type ResultadoDeSaida = {
  /** Se a pessoa ocupava vaga (`in`) — é o que decide se existe evento a cancelar. */
  saiuDeVaga: boolean;
  promovido: number | null;
};

/**
 * Tira alguém da lista e, se isso abriu uma vaga, promove o primeiro da espera.
 *
 * Devolve o `playerId` promovido, para quem chama avisar a pessoa (ver
 * avisoDePromocao) — no mesmo commit, pelo mesmo motivo do aviso de inclusão. E
 * devolve se a saída foi de uma vaga: só quem ocupava uma tinha evento na
 * agenda para cancelar.
 *
 * A promoção só é automática com a lista **aberta**. Fechada, a vaga que abre é
 * de quem o admin disser: ele está registrando quem apareceu, e subir sozinho
 * alguém que não está na quadra criaria presença de quem não jogou — exatamente
 * o problema que a falta existe para resolver.
 *
 * Sair de uma vaga é o único caso que promove. Quem estava na espera, ou já
 * estava fora, não deixa vaga nenhuma para trás.
 */
export async function sairDaLista(
  exec: Executor,
  matchDayId: number,
  playerId: number,
): Promise<ResultadoDeSaida> {
  const fut = await travarFut(exec, matchDayId);
  exigirNaoEncerrada(fut, matchDayId);
  const linhas = await linhasDaLista(exec, matchDayId);
  const ocupavaVaga = linhas.find((l) => l.playerId === playerId)?.status === "in";

  await exec
    .insert(attendances)
    .values({ matchDayId, playerId, status: "out", confirmedAt: null })
    .onConflictDoUpdate({
      target: [attendances.matchDayId, attendances.playerId],
      set: {
        status: "out",
        confirmedAt: null,
        updatedAt: new Date(),
        calendarSequence: sql`${attendances.calendarSequence} + 1`,
      },
    });

  if (!ocupavaVaga || listaFechada(fut.status)) {
    return { saiuDeVaga: ocupavaVaga, promovido: null };
  }
  // "Abriu uma vaga" é literal: o limite pode ter sido reduzido para baixo dos
  // confirmados (updateMatchDay aceita, e não rebaixa ninguém), e aí a saída
  // ainda deixa a lista cheia — promover aqui furaria o limite novo.
  const ocupadasAposSaida = linhas.filter(
    (l) => l.status === "in" && l.playerId !== playerId,
  ).length;
  if (fut.maxPlayers !== null && ocupadasAposSaida >= fut.maxPlayers) {
    return { saiuDeVaga: true, promovido: null };
  }
  const proximo = proximoDaEspera(linhas);
  if (!proximo) return { saiuDeVaga: true, promovido: null };

  await exec
    .update(attendances)
    .set({
      status: "in",
      updatedAt: new Date(),
      calendarSequence: sql`${attendances.calendarSequence} + 1`,
    })
    .where(
      and(
        eq(attendances.matchDayId, matchDayId),
        eq(attendances.playerId, proximo.playerId),
      ),
    );
  return { saiuDeVaga: true, promovido: proximo.playerId };
}

/**
 * Sobe alguém da espera para uma vaga, na mão do admin.
 *
 * O escopo por `waitlist` no `where` é a guarda: `playerId` vem do cliente, e
 * sem ele isto viraria um "marcar presença" sem passar pelo
 * podeDefinirPresencaPor — daria para pôr no fut quem tinha marcado "Fora".
 *
 * Devolve se alguém subiu de fato. Quem já estava `in` não casa o `where` e não
 * versiona nada: sem este retorno, quem chama mandaria convite de agenda repetido
 * com a SEQUENCE velha (um duplo clique em "Promover" bastava).
 */
export async function subirDaEspera(
  exec: Executor,
  matchDayId: number,
  playerId: number,
): Promise<boolean> {
  const fut = await travarFut(exec, matchDayId);
  exigirNaoEncerrada(fut, matchDayId);
  const subiram = await exec
    .update(attendances)
    .set({
      status: "in",
      updatedAt: new Date(),
      calendarSequence: sql`${attendances.calendarSequence} + 1`,
    })
    .where(
      and(
        eq(attendances.matchDayId, matchDayId),
        eq(attendances.playerId, playerId),
        eq(attendances.status, "waitlist"),
      ),
    )
    .returning({ playerId: attendances.playerId });
  return subiram.length > 0;
}

/**
 * Registra que alguém confirmou e não apareceu — ou desfaz o registro.
 *
 * Escopo pelo status de origem, como no subirDaEspera: só troca entre `in` e
 * `no_show`, então nem "Fora" vira presença nem presença vira falta por um id
 * repetido que chegou do cliente.
 */
export async function registrarFalta(
  exec: Executor,
  matchDayId: number,
  playerId: number,
  faltou: boolean,
): Promise<void> {
  const fut = await travarFut(exec, matchDayId);
  exigirNaoEncerrada(fut, matchDayId);
  await exec
    .update(attendances)
    .set({ status: faltou ? "no_show" : "in", updatedAt: new Date() })
    .where(
      and(
        eq(attendances.matchDayId, matchDayId),
        eq(attendances.playerId, playerId),
        eq(attendances.status, faltou ? "in" : "no_show"),
      ),
    );
}

/**
 * Sobe a espera para as vagas que um limite maior abriu, por ordem de chegada.
 *
 * É o par do updateMatchDay: subir (ou limpar) o limite abre vagas sem ninguém
 * sair, e sem isto a espera ficava parada enquanto o próximo "Vou" entrava
 * direto — furando a fila de quem confirmou antes.
 *
 * Devolve os promovidos, para quem chama avisar cada um. Com a lista fechada não
 * faz nada: vaga de lista fechada é de quem o admin disser.
 */
export async function preencherVagasAbertas(
  exec: Executor,
  matchDayId: number,
): Promise<number[]> {
  const fut = await travarFut(exec, matchDayId);
  if (listaFechada(fut.status)) return [];

  const linhas = await linhasDaLista(exec, matchDayId);
  const ocupadas = linhas.filter((l) => l.status === "in").length;
  const livres =
    fut.maxPlayers === null ? Number.POSITIVE_INFINITY : fut.maxPlayers - ocupadas;
  if (livres <= 0) return [];

  const sobem = ordenarPorChegada(linhas.filter((l) => l.status === "waitlist"))
    .slice(0, Number.isFinite(livres) ? livres : undefined)
    .map((l) => l.playerId);
  if (sobem.length === 0) return [];

  await exec
    .update(attendances)
    .set({
      status: "in",
      updatedAt: new Date(),
      calendarSequence: sql`${attendances.calendarSequence} + 1`,
    })
    .where(
      and(
        eq(attendances.matchDayId, matchDayId),
        inArray(attendances.playerId, sobem),
        eq(attendances.status, "waitlist"),
      ),
    );
  return sobem;
}
