// Orquestra os e-mails de agenda: banco + montagem + envio, sempre FORA de
// transação e fora da request (after) — espelho de email-convite.ts para o
// domínio da agenda. O dispatcher relê o estado na hora de enviar: um convite
// só sai para quem está `in` AGORA e um cancelamento só para quem está `out`
// AGORA. É isso que desarma corridas entre cliques rápidos — o e-mail atrasado
// do estado velho simplesmente não encontra mais o estado e desiste.

import "server-only";
import { after } from "next/server";
import { and, eq, gt, inArray, isNull, lte, notInArray, or, sql } from "drizzle-orm";
import { db, type Executor } from "@/db";
import { attendances, matchDays, players, users } from "@/db/schema";
import { icsDeConvite, type FutParaAgenda } from "./agenda";
import { emailConfigurado, enderecoDoRemetente, enviarEmail } from "./email-envio";
import {
  type ContagensDeAgenda,
  JANELA_AGENDA_POR_FUT_MIN,
  JANELA_DIARIA_HORAS,
  motivoDeBloqueioDeAgenda,
  TETO_AGENDA_DIA,
} from "./freios-de-envio";
import { emailDeEventoDeAgenda, type TipoDeEventoDeAgenda } from "./email-modelos";
import { siteUrl } from "./site-url";

export type DestinoDeAgenda = {
  playerId: number;
  nome: string;
  email: string;
  sequence: number;
};

type TipoDeSincronizacao = "convite" | "atualizacao" | "saida";

// O status que legitima cada e-mail na hora do envio (ver comentário do topo).
const STATUS_ESPERADO: Record<TipoDeSincronizacao, "in" | "out"> = {
  convite: "in",
  atualizacao: "in",
  saida: "out",
};

type LinhaDeDestino = {
  playerId: number;
  sequence: number;
  apelido: string | null;
  nomeCompleto: string;
  email: string | null;
  contactEmail: string | null;
};

/** A linha do `sincronizar`, com os fatos que `motivoDeBloqueioDeAgenda` lê. */
type LinhaComContagem = LinhaDeDestino & Omit<ContagensDeAgenda, "daInstalacaoNoDia">;

function paraDestino(linha: LinhaDeDestino): DestinoDeAgenda | null {
  const email = linha.email ?? linha.contactEmail;
  if (!email) return null;
  return {
    playerId: linha.playerId,
    nome: linha.apelido ?? linha.nomeCompleto,
    email,
    sequence: linha.sequence,
  };
}

/**
 * Carimba o envio no par (fut, jogador) — o ledger do freio.
 *
 * **Carimbo E contador.** O carimbo sozinho não era ledger: ele é sobrescrito,
 * então dez envios e um envio deixam a linha idêntica, e os tetos — que somavam
 * linhas carimbadas — ficavam presos em 1 por par. O cancelamento é isento da
 * janela por par (ver `sincronizar`), então alternar "Vou"/"Fora" no mesmo fut
 * mandava um e-mail por ciclo, indefinidamente, sem mover contador nenhum. O
 * contador é o que faz os dois tetos valerem para os três tipos de e-mail.
 *
 * `else 1` e não `else 0 + 1`: quando o carimbo anterior já saiu da janela de
 * 24h, a contagem antiga não conta mais e a coluna recomeça neste envio. É o
 * que dispensa GC — fora da janela ninguém lê o número, e o próximo envio o
 * recicla.
 *
 * Best-effort, e pelo mesmo motivo do `email_sent_at` de `enviarConvitePorEmail`:
 * o e-mail já saiu, escrita não tem retentativa, e deixar um tropeço de pool
 * estourar aqui daria tela de erro por um envio que deu certo. O custo de
 * falhar é aquele e-mail não contar para a cota.
 */
async function carimbarEnvio(matchDayId: number, playerId: number): Promise<void> {
  await db
    .update(attendances)
    .set({
      agendaEmailSentAt: new Date(),
      // Referências a colunas no lado direito de um UPDATE enxergam o valor
      // ANTIGO da linha — é o carimbo anterior que decide entre somar e zerar.
      agendaEmailsSent: sql`case
        when ${attendances.agendaEmailSentAt} > now() - make_interval(hours => ${JANELA_DIARIA_HORAS})
        then ${attendances.agendaEmailsSent} + 1
        else 1
      end`,
    })
    .where(and(eq(attendances.matchDayId, matchDayId), eq(attendances.playerId, playerId)))
    .catch((erro) => {
      console.error("[agenda-convite] não carimbou agenda_email_sent_at:", erro);
    });
}

async function enviarParaDestinos(
  fut: FutParaAgenda,
  destinos: DestinoDeAgenda[],
  tipo: TipoDeEventoDeAgenda,
  /** Carimba o ledger a cada envio. Só o cancelamento pós-exclusão não pode:
   *  as `attendances` já foram pelo cascade e não há linha para carimbar. */
  carimbar = true,
): Promise<void> {
  const metodo = tipo === "convite" || tipo === "atualizacao" ? "REQUEST" : "CANCEL";
  const organizador = { nome: "FutZenha", email: enderecoDoRemetente() };
  // Sequencial de propósito: o free tier do Resend aceita ~2 req/s, e o retry
  // de rajada do transporte só segura o resto se não formos nós a rajada.
  for (const destino of destinos) {
    const ics = icsDeConvite({
      fut,
      urlBase: siteUrl(),
      metodo,
      sequence: destino.sequence,
      agora: new Date(),
      organizador,
      convidado: destino,
    });
    const resultado = await enviarEmail({
      para: destino.email,
      ...emailDeEventoDeAgenda({ tipo, nome: destino.nome, fut }),
      anexos: [
        {
          nomeDoArquivo: `fut-${fut.id}.ics`,
          conteudo: ics,
          contentType: `text/calendar; charset=utf-8; method=${metodo}`,
        },
      ],
    });
    if (resultado.ok) {
      if (carimbar) await carimbarEnvio(fut.id, destino.playerId);
    } else {
      console.error("[agenda-convite] evento de agenda não saiu:", {
        matchDayId: fut.id,
        playerId: destino.playerId,
        tipo,
        motivo: resultado.motivo,
      });
    }
  }
}

async function sincronizar(
  matchDayId: number,
  alvo: number[] | "todos-in",
  tipo: TipoDeSincronizacao,
  exceto: number[] = [],
): Promise<void> {
  const [fut] = await db
    .select({
      id: matchDays.id,
      date: matchDays.date,
      startTime: matchDays.startTime,
      endTime: matchDays.endTime,
      location: matchDays.location,
      notes: matchDays.notes,
      status: matchDays.status,
    })
    .from(matchDays)
    .where(eq(matchDays.id, matchDayId));
  // Fut que sumiu tem o próprio fluxo de cancelamento (pós-exclusão); fut
  // encerrado é passado e agenda de passado não se mexe.
  if (!fut || fut.status === "finished") return;

  const condicoes = [
    eq(attendances.matchDayId, matchDayId),
    eq(attendances.status, STATUS_ESPERADO[tipo]),
  ];
  if (alvo !== "todos-in") condicoes.push(inArray(attendances.playerId, alvo));
  if (exceto.length > 0) condicoes.push(notInArray(attendances.playerId, exceto));

  // O sub-teto da instalação é uma pergunta só, feita antes do laço — se a
  // agenda já gastou a cota do dia, ninguém recebe e não vale montar destino.
  // Ver o comentário de TETO_AGENDA_DIA: é ele que impede a conveniência de
  // comer a cota do link de redefinição de acesso.
  const daInstalacaoNoDia = await enviadosPelaAgendaNoDia();
  if (daInstalacaoNoDia >= TETO_AGENDA_DIA) {
    console.warn("[agenda-convite] teto diário da agenda atingido — nenhum e-mail neste lote.");
    return;
  }

  // Os fatos por pessoa vêm na PRÓPRIA consulta de destinos — nenhum round-trip
  // a mais. Quem DECIDE com eles é `motivoDeBloqueioDeAgenda` (./freios-de-envio),
  // e não um `where` daqui: a regra é a mesma para os três tipos de e-mail e o
  // teste unitário dela só vale alguma coisa se for esta a função que roda.
  const linhas: LinhaComContagem[] = await db
    .select({
      playerId: attendances.playerId,
      sequence: attendances.calendarSequence,
      apelido: players.nickname,
      nomeCompleto: players.name,
      email: users.email,
      contactEmail: users.contactEmail,
      // A janela por par (fut, jogador) — o freio que mata o loop de alternar
      // "Vou"/"Fora". Nulo (nunca recebeu) é `false`.
      recebeuHaPouco: sql<boolean>`(
        ${attendances.agendaEmailSentAt} > now() - make_interval(mins => ${JANELA_AGENDA_POR_FUT_MIN})
      )`,
      // Soma de e-mails, não contagem de linhas: o carimbo é sobrescrito, então
      // `count(*)` media pares e não envios — ver `carimbarEnvio`.
      doJogadorNoDia: sql<number>`(
        select coalesce(sum(a2.agenda_emails_sent), 0)::int from attendances a2
         where a2.player_id = ${attendances.playerId}
           and a2.agenda_email_sent_at > now() - make_interval(hours => ${JANELA_DIARIA_HORAS})
      )`,
    })
    .from(attendances)
    .innerJoin(players, eq(players.id, attendances.playerId))
    .innerJoin(users, and(eq(users.playerId, attendances.playerId), eq(users.active, true)))
    .where(and(...condicoes));

  const destinos = linhas
    .filter(
      (l) =>
        motivoDeBloqueioDeAgenda({
          // O CANCELAMENTO é isento da janela por par, e essa assimetria é a
          // regra: um e-mail que ADICIONA evento pode esperar a janela passar,
          // porque o custo de atrasá-lo é a pessoa não ver o fut na agenda — e
          // ela sabe que confirmou. Um e-mail que REMOVE evento não pode:
          // suprimi-lo deixa na agenda dela um fut em que ela não está, e nada
          // depois vem corrigir isso. Calendário que mente é pior que
          // calendário atrasado.
          //
          // A isenção é só da janela. Os dois TETOS valem para o cancelamento
          // também, e é o que fecha o loop: alternar presença custa no máximo
          // TETO_AGENDA_POR_JOGADOR_DIA e-mails por dia, não infinitos.
          recebeuHaPouco: tipo === "saida" ? false : l.recebeuHaPouco,
          doJogadorNoDia: l.doJogadorNoDia,
          daInstalacaoNoDia,
        }) === null,
    )
    .map(paraDestino)
    .filter((d): d is DestinoDeAgenda => d !== null);

  await enviarParaDestinos(fut, destinos, tipo);
}

/**
 * Quantos e-mails de agenda a instalação mandou nas últimas 24h.
 *
 * Soma envios, não linhas carimbadas — o carimbo é sobrescrito, e um `count(*)`
 * aqui contava pares (fut, jogador) achando que contava e-mails. É a mesma
 * régua de `tetoDiarioAtingido` em ./email-convite, que consome este número.
 */
export async function enviadosPelaAgendaNoDia(): Promise<number> {
  const [linha] = await db
    .select({ total: sql<number>`coalesce(sum(${attendances.agendaEmailsSent}), 0)::int` })
    .from(attendances)
    .where(
      gt(
        attendances.agendaEmailSentAt,
        sql`now() - make_interval(hours => ${JANELA_DIARIA_HORAS})`,
      ),
    );
  return linha?.total ?? 0;
}

function agendar(tarefa: () => Promise<void>): void {
  if (!emailConfigurado()) return;
  after(async () => {
    try {
      await tarefa();
    } catch (erro) {
      // O `.catch` é obrigatório: rejeição não tratada dentro do after()
      // derruba o log da request inteira (ver src/lib/pendencias.ts).
      console.error("[agenda-convite] sincronização de agenda falhou:", erro);
    }
  });
}

/** Convite (REQUEST) para quem acabou de ficar `in` — inclusive promovido da espera. */
export function agendarConvitesDeAgenda(matchDayId: number, playerIds: number[]): void {
  if (playerIds.length === 0) return;
  agendar(() => sincronizar(matchDayId, playerIds, "convite"));
}

/**
 * Atualização (REQUEST com SEQUENCE novo) para todos os `in` — data/hora/local
 * mudou.
 *
 * `exceto` tira dessa leva quem acabou de entrar na lista no mesmo salvamento:
 * "o fut mudou" fala de um evento que a pessoa já tinha, e quem subiu da espera
 * agora nunca teve nenhum. Esses recebem o convite normal, por
 * agendarConvitesDeAgenda — um e-mail por pessoa, o certo para cada uma.
 */
export function agendarAtualizacoesDeAgenda(matchDayId: number, exceto: number[] = []): void {
  agendar(() => sincronizar(matchDayId, "todos-in", "atualizacao", exceto));
}

/** Cancelamento (CANCEL) para quem saiu de vaga e está `out` agora. */
export function agendarCancelamentosDeAgenda(matchDayId: number, playerIds: number[]): void {
  if (playerIds.length === 0) return;
  agendar(() => sincronizar(matchDayId, playerIds, "saida"));
}

/**
 * Pré-leitura dos destinos DENTRO da transação que vai apagar o fut: o cascade
 * leva as attendances junto, e depois não há mais de onde tirar e-mail nem
 * SEQUENCE. O +1 garante que este CANCEL supera qualquer REQUEST já enviado.
 */
export async function lerDestinosDeCancelamento(
  exec: Executor,
  matchDayId: number,
): Promise<DestinoDeAgenda[]> {
  const linhas: LinhaDeDestino[] = await exec
    .select({
      playerId: attendances.playerId,
      sequence: attendances.calendarSequence,
      apelido: players.nickname,
      nomeCompleto: players.name,
      email: users.email,
      contactEmail: users.contactEmail,
    })
    .from(attendances)
    .innerJoin(players, eq(players.id, attendances.playerId))
    .innerJoin(users, and(eq(users.playerId, attendances.playerId), eq(users.active, true)))
    .where(
      and(
        eq(attendances.matchDayId, matchDayId),
        eq(attendances.status, "in"),
        // O freio por par vale aqui também, e é o único que dá para aplicar
        // neste fluxo: depois do delete não sobra linha para carimbar, então
        // estes envios não CONTAM para os tetos — mas quem acabou de receber
        // ainda assim não recebe de novo. O que limita o resto é o teto de
        // criação de fut (src/lib/tetos-de-criacao.ts): sem ele, criar e apagar
        // fut em loop seria um cancelamento por ciclo, sem ledger nenhum.
        or(
          isNull(attendances.agendaEmailSentAt),
          lte(
            attendances.agendaEmailSentAt,
            sql`now() - make_interval(mins => ${JANELA_AGENDA_POR_FUT_MIN})`,
          ),
        ),
      ),
    );
  return linhas
    .map(paraDestino)
    .filter((d): d is DestinoDeAgenda => d !== null)
    .map((d) => ({ ...d, sequence: d.sequence + 1 }));
}

/** Cancelamento de fut apagado — os destinos vieram de lerDestinosDeCancelamento. */
export function agendarCancelamentosPosExclusao(
  fut: FutParaAgenda,
  destinos: DestinoDeAgenda[],
): void {
  if (destinos.length === 0) return;
  // `carimbar: false` — o fut já foi apagado e o cascade levou as attendances;
  // não há linha onde gravar o envio.
  agendar(() => enviarParaDestinos(fut, destinos, "fut-cancelado", false));
}
