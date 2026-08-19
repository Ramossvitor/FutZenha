// Freio do aviso de agenda em massa.
//
// Mudar data/hora/local do fut reescreve o evento na agenda de TODO mundo que
// confirmou — é o que faz a correção chegar sozinha, e é também o que quem
// administra o fut poderia usar para encher a agenda alheia: salvar o
// formulário cinquenta vezes com o horário oscilando são cinquenta e-mails e
// cinquenta reescritas para cada confirmado.
//
// O freio pega só a atualização em massa. Convite e cancelamento continuam
// livres: vão para uma pessoa só, e por causa de um clique dela mesma.
//
// Estourado o limite, a mudança SALVA normalmente — o banco nunca mente sobre o
// fut. O que não sai é o e-mail, e quem administra vê isso na tela.

import "server-only";
import { eq, sql } from "drizzle-orm";
import type { Executor } from "@/db";
import { matchDays } from "@/db/schema";

export const LIMITE_PUSHES_AGENDA_DIA = 5;

/**
 * Consome uma cota de aviso de agenda do fut. `true` = pode avisar.
 *
 * Um único UPDATE ... RETURNING: ler-e-depois-gravar deixaria dois salvamentos
 * simultâneos passarem pela mesma cota. A janela é de 24h corridas a partir do
 * primeiro aviso, e vem de `now()` do Postgres — `new Date()` em SQL cru quebra
 * o driver serverless (ver AGENTS.md).
 */
export async function consumirPushDeAgenda(
  exec: Executor,
  matchDayId: number,
): Promise<boolean> {
  const janelaExpirou = sql`${matchDays.calendarPushesSince} is null or ${matchDays.calendarPushesSince} < now() - interval '24 hours'`;
  const [linha] = await exec
    .update(matchDays)
    .set({
      calendarPushes: sql`case when ${janelaExpirou} then 1 else ${matchDays.calendarPushes} + 1 end`,
      calendarPushesSince: sql`case when ${janelaExpirou} then now() else ${matchDays.calendarPushesSince} end`,
    })
    .where(eq(matchDays.id, matchDayId))
    .returning({ pushes: matchDays.calendarPushes });
  return (linha?.pushes ?? 0) <= LIMITE_PUSHES_AGENDA_DIA;
}
