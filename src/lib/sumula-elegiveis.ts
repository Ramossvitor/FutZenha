import "server-only";
import { and, asc, eq, exists, type SQL, type SQLWrapper } from "drizzle-orm";
import { db } from "@/db";
import { attendances, players, users } from "@/db/schema";

/**
 * Quem pode segurar a súmula por delegação: está na lista DESTE fut com
 * presença `in` (a súmula fica com quem está na quadra, revezando) e tem conta
 * ativa (senão a pessoa nem loga para abrir o painel).
 *
 * Uma definição só, para os quatro lugares que precisam concordar: o select que
 * oferece candidatos (sumula/dados.ts), a action que aceita a delegação, o
 * guard que a honra a cada request, e a lista de futs operáveis do relógio
 * (src/lib/futs-operaveis.ts, pelo `existePresencaElegivel`). Enquanto a
 * condição estava escrita em cada um, a delegação sobrevivia à saída da lista
 * — quem desistia no meio do fut continuava lançando gol o dia inteiro.
 *
 * `matchDayId` aceita uma coluna (`matchDays.id`) para a consulta poder ser
 * correlacionada de dentro de outra.
 */
function consultaElegiveis(matchDayId: number | SQLWrapper, extra?: SQL) {
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

/**
 * O mesmo predicado como `EXISTS` correlacionado, para quem decide dentro de
 * uma query maior — `matchDayId` é a coluna da query de fora.
 */
export function existePresencaElegivel(matchDayId: SQLWrapper, playerId: number): SQL {
  return exists(consultaElegiveis(matchDayId, eq(attendances.playerId, playerId)));
}
