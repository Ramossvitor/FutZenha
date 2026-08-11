// O recorte das estatísticas, separado de ./stats de propósito.
//
// ./stats importa `server-only` e `@/db`, e o vitest daqui roda sem config e sem
// alias — nenhum teste alcança aquele módulo. Estes dois predicados são a única
// coisa lá dentro que decide QUAIS futs entram na conta, e eles falham em
// silêncio: se o filtro por grupo sumisse, toda página continuaria renderizando
// e todo teste continuaria passando, só que o ranking do grupo passaria a
// mostrar os números da plataforma inteira. Por isso moram aqui, num módulo puro
// que importa `../db/schema` por caminho relativo (o schema só importa drizzle).

import { and, eq, sql, type SQL } from "drizzle-orm";
import { matchDays } from "../db/schema";

/**
 * O recorte das estatísticas.
 *
 * `groupId` filtra pelos futs daquele grupo e NADA MAIS: quem entra no
 * ranking do grupo é quem JOGOU os futs dele, membro ou não. Não há join com
 * `group_members` aqui de propósito — o convidado de última hora que fez três
 * gols conta na artilharia do grupo, e é assim que o usuário pediu. A única
 * exclusão continua sendo a de sempre, o `innerJoin(users, active)` lá em
 * ./stats: só entra em ranking quem tem conta ativa.
 *
 * Objeto em vez de parâmetros posicionais porque já são duas dimensões, e uma
 * terceira chegaria como `getTopScorers(undefined, undefined, 3)`.
 */
export type EscopoStats = { year?: number; groupId?: number };

export function escopo({ year, groupId }: EscopoStats = {}): SQL | undefined {
  return and(
    eq(matchDays.status, "finished"),
    year ? sql`extract(year from ${matchDays.date}) = ${year}` : undefined,
    groupId ? eq(matchDays.groupId, groupId) : undefined,
  );
}

/**
 * Quem entrou em campo em algum fut encerrado do grupo.
 *
 * `getSkillRanking` não usa `escopo()` — ele parte de `players`, não de
 * `match_days` — e por isso repete aqui as duas condições que importam
 * (`groupId` e `finished`). É o caminho divergente do módulo, e o que mais
 * precisa de teste justamente por não compartilhar o filtro com os outros
 * quatro.
 *
 * `gamePlayers` é a fonte de verdade de quem jogou: presença confirmada e não
 * comparecer não conta aqui.
 */
export function jogouNoGrupo(groupId: number): SQL {
  return and(eq(matchDays.groupId, groupId), eq(matchDays.status, "finished"))!;
}
