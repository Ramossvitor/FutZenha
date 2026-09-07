import "server-only";
import { and, asc, eq, exists, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { games, groupMembers, matchDays, sumulaOperadores } from "@/db/schema";
import type { Session } from "./session";
import { existePresencaElegivel } from "./sumula-elegiveis";
import type { CandidatoAFut } from "./sumula-relogio";

export type FutOperavel = CandidatoAFut & { date: string; location: string };

/**
 * Os futs com times sorteados que esta pessoa pode operar pela súmula — a
 * lista de onde `escolherFutParaOperar` (./sumula-relogio.ts) tira "o fut de
 * agora" para o relógio, que não digita id.
 *
 * É um PRÉ-FILTRO, não a autoridade: a API reexecuta `operadorDeSumula`
 * (./require-operador-sumula.ts) no fut escolhido, e é lá que `podeOperarSumula`
 * decide. As três condições daqui espelham as do guard — criador, admin do
 * grupo do fut, delegação válida (a linha em `sumula_operadores` mais a
 * presença elegível, que é a definição de ./sumula-elegiveis.ts, importada e
 * não reescrita) — e o admin da plataforma enxerga todos, como lá. Divergir do
 * guard daria um fut na lista que o guard depois recusa com 404, e o atalho
 * diria "nenhum fut" para quem tem um.
 *
 * `vinculoDireto` é só para a escolha: para quem não é admin da plataforma,
 * toda linha é de vínculo direto (senão não passaria no WHERE); para o admin,
 * separa o fut EM que ele está do fut que ele só alcança.
 *
 * `distanciaEmDias` e `temJogoAberto` saem do Postgres — regra da casa: nada
 * de relógio da aplicação em decisão de domínio. E o "hoje" é o de Brasília,
 * como em toda comparação de data do app (ver ./pendencias.ts): `current_date`
 * é o dia da sessão do banco, UTC na Neon, que vira às 21h daqui — e a partir
 * daí o fut de hoje perderia para o de amanhã na escolha automática.
 */
export async function listarFutsOperaveis(session: Session): Promise<FutOperavel[]> {
  const me = session.player.id;

  const criador = eq(matchDays.createdByPlayerId, me);
  const adminDoGrupo = exists(
    db
      .select({ um: sql`1` })
      .from(groupMembers)
      .where(
        and(
          eq(groupMembers.groupId, matchDays.groupId),
          eq(groupMembers.playerId, me),
          eq(groupMembers.role, "admin"),
        ),
      ),
  );
  const presente = existePresencaElegivel(matchDays.id, me);
  const delegado = and(
    exists(
      db
        .select({ um: sql`1` })
        .from(sumulaOperadores)
        .where(and(eq(sumulaOperadores.matchDayId, matchDays.id), eq(sumulaOperadores.playerId, me))),
    ),
    presente,
  );
  const opera = or(criador, adminDoGrupo, delegado);

  return db
    .select({
      id: matchDays.id,
      date: matchDays.date,
      location: matchDays.location,
      temJogoAberto: sql<boolean>`${exists(
        db
          .select({ um: sql`1` })
          .from(games)
          .where(
            and(
              eq(games.matchDayId, matchDays.id),
              isNotNull(games.startedAt),
              isNull(games.finishedAt),
            ),
          ),
      )}`,
      distanciaEmDias: sql<number>`abs(${matchDays.date} - (now() at time zone 'America/Sao_Paulo')::date)::int`,
      vinculoDireto: session.isPlatformAdmin
        ? sql<boolean>`(${or(opera, presente)})`
        : sql<boolean>`true`,
    })
    .from(matchDays)
    .where(
      session.isPlatformAdmin
        ? eq(matchDays.status, "teams_drawn")
        : and(eq(matchDays.status, "teams_drawn"), opera),
    )
    .orderBy(asc(matchDays.date), asc(matchDays.id));
}
