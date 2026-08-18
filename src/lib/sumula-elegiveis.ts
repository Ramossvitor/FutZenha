import "server-only";
import { and, asc, eq, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { attendances, players, users } from "@/db/schema";

/**
 * Quem pode segurar a súmula por delegação: está na lista DESTE fut com
 * presença `in` (a súmula fica com quem está na quadra, revezando) e tem conta
 * ativa (senão a pessoa nem loga para abrir o painel).
 *
 * Uma definição só, para os três lugares que precisam concordar: o select que
 * oferece candidatos (sumula/dados.ts), a action que aceita a delegação, e o
 * guard que a honra a cada request. Enquanto a condição estava escrita em cada
 * um, a delegação sobrevivia à saída da lista — quem desistia no meio do fut
 * continuava lançando gol o dia inteiro.
 */
function consultaElegiveis(matchDayId: number, extra?: SQL) {
  return db
    .select({ playerId: players.id, nome: players.name, apelido: players.nickname })
    .from(attendances)
    .innerJoin(players, eq(attendances.playerId, players.id))
    .innerJoin(users, and(eq(users.playerId, players.id), eq(users.active, true)))
    .where(and(eq(attendances.matchDayId, matchDayId), eq(attendances.status, "in"), extra));
}

/** Todos os elegíveis do fut, em ordem de nome — o universo do select. */
export async function elegiveisParaSumula(matchDayId: number) {
  return consultaElegiveis(matchDayId).orderBy(asc(players.name));
}

/** O mesmo predicado para uma pessoa só. */
export async function ehElegivelParaSumula(matchDayId: number, playerId: number) {
  const [linha] = await consultaElegiveis(matchDayId, eq(attendances.playerId, playerId));
  return linha !== undefined;
}
