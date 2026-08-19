// Orquestra os e-mails de agenda: banco + montagem + envio, sempre FORA de
// transação e fora da request (after) — espelho de email-convite.ts para o
// domínio da agenda. O dispatcher relê o estado na hora de enviar: um convite
// só sai para quem está `in` AGORA e um cancelamento só para quem está `out`
// AGORA. É isso que desarma corridas entre cliques rápidos — o e-mail atrasado
// do estado velho simplesmente não encontra mais o estado e desiste.

import "server-only";
import { after } from "next/server";
import { and, eq, inArray, notInArray } from "drizzle-orm";
import { db, type Executor } from "@/db";
import { attendances, matchDays, players, users } from "@/db/schema";
import { icsDeConvite, type FutParaAgenda } from "./agenda";
import { emailConfigurado, enderecoDoRemetente, enviarEmail } from "./email-envio";
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

async function enviarParaDestinos(
  fut: FutParaAgenda,
  destinos: DestinoDeAgenda[],
  tipo: TipoDeEventoDeAgenda,
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
    if (!resultado.ok) {
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

  const linhas: LinhaDeDestino[] = await db
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
    .where(and(...condicoes));

  await enviarParaDestinos(
    fut,
    linhas.map(paraDestino).filter((d): d is DestinoDeAgenda => d !== null),
    tipo,
  );
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
    .where(and(eq(attendances.matchDayId, matchDayId), eq(attendances.status, "in")));
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
  agendar(() => enviarParaDestinos(fut, destinos, "fut-cancelado"));
}
