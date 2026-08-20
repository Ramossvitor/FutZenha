// Freio do aviso de agenda em massa.
//
// Mudar data/hora/término/local do fut reescreve o evento na agenda de TODO
// mundo que confirmou — é o que faz a correção chegar sozinha, e é também o que
// quem administra o fut poderia usar para encher a agenda alheia: salvar o
// formulário cinquenta vezes com o horário oscilando são cinquenta e-mails e
// cinquenta reescritas para cada confirmado.
//
// Estourado o limite, a mudança SALVA normalmente — o banco nunca mente sobre o
// fut. O que não sai é o e-mail, e quem administra vê isso na tela.
//
// ---------------------------------------------------------------------------
// O que este freio NÃO cobre, e onde o resto mora
// ---------------------------------------------------------------------------
//
// Aqui está só a atualização em MASSA (um e-mail por confirmado, de uma vez).
// Convite e cancelamento são um e-mail para uma pessoa, e por muito tempo a
// justificativa escrita neste arquivo foi que eles saem "por causa de um clique
// dela mesma". **Isso vale só para `setMyAttendance`.** Em `definirPresenca`,
// `promoverDaEspera` e `incluirNoJogo` quem clica é o organizador e quem recebe
// é outra pessoa — e num fut avulso o alcance disso já foi a plataforma
// inteira.
//
// Os freios desses caminhos moram em ./freios-de-envio (as regras) e em
// ./agenda-convite (a aplicação), com ledger em `attendances.agenda_email_sent_at`:
// janela por par (fut, jogador), teto por caixa de entrada e sub-teto da
// instalação. Este arquivo continua existindo porque o alvo dele é outro: não é
// "quantos e-mails uma pessoa recebeu", é "quantas vezes UM FUT pode disparar
// um lote".

import "server-only";
import { eq, sql } from "drizzle-orm";
import type { Executor } from "@/db";
import { attendances, matchDays } from "@/db/schema";
import { emailConfigurado } from "./email-envio";

export const LIMITE_PUSHES_AGENDA_DIA = 5;

/**
 * De quanto em quanto tempo uma cota volta.
 *
 * O freio é um **token bucket**, e não uma janela fixa com contador zerado de
 * tempos em tempos. A diferença aparece na virada: com janela fixa, cinco
 * disparos no fim de uma janela e cinco no começo da seguinte são dez em
 * minutos — exatamente o dobro do teto, no pior momento possível. Com reposição
 * contínua, a quinta cota só volta 24h depois de ter sido gasta.
 */
const INTERVALO_DE_REPOSICAO_SEG = (24 * 3600) / LIMITE_PUSHES_AGENDA_DIA;

/**
 * Quantas cotas voltaram desde a última marcação.
 *
 * `null` (fut que nunca disparou) devolve o teto cheio. Referências a colunas
 * no lado direito de um UPDATE enxergam o valor ANTIGO da linha, então repetir
 * esta expressão nos dois `set` abaixo dá o mesmo número nas duas.
 */
const REPOSTO = sql`case
  when ${matchDays.calendarPushesSince} is null then ${LIMITE_PUSHES_AGENDA_DIA}
  else floor(
    extract(epoch from (now() - ${matchDays.calendarPushesSince})) / ${INTERVALO_DE_REPOSICAO_SEG}
  )::int
end`;

/**
 * Consome uma cota de aviso de agenda do fut. `true` = pode avisar.
 *
 * Um único UPDATE ... RETURNING: ler-e-depois-gravar deixaria dois salvamentos
 * simultâneos passarem pela mesma cota. O relógio é o `now()` do Postgres —
 * `new Date()` em SQL cru quebra o driver serverless (ver AGENTS.md).
 *
 * **Não consome à toa.** Cota gasta num fut sem ninguém confirmado, ou num
 * ambiente sem `RESEND_API_KEY`, é cota que falta na mudança que importa — e o
 * organizador não teria como saber por que acabou. Por isso as duas perguntas
 * antes do UPDATE: elas devolvem `true` sem tocar no contador, porque não houve
 * e-mail nenhum a limitar.
 */
export async function consumirPushDeAgenda(
  exec: Executor,
  matchDayId: number,
): Promise<boolean> {
  // Sem key, `agendarAtualizacoesDeAgenda` é no-op — não há envio a frear.
  if (!emailConfigurado()) return true;

  // Ninguém confirmado, nenhum destinatário. O `limit 1` é o suficiente: a
  // pergunta é "existe algum", não "quantos".
  const [alguem] = await exec
    .select({ playerId: attendances.playerId })
    .from(attendances)
    .where(sql`${attendances.matchDayId} = ${matchDayId} and ${attendances.status} = 'in'`)
    .limit(1);
  if (!alguem) return true;

  const [linha] = await exec
    .update(matchDays)
    .set({
      calendarPushes: sql`greatest(0, ${matchDays.calendarPushes} - (${REPOSTO})) + 1`,
      // Só reposiciona o marco quando alguma cota de fato voltou. Movê-lo a cada
      // disparo faria a reposição nunca acontecer; deixá-lo parado faria o
      // saldo repor duas vezes pelo mesmo tempo decorrido.
      calendarPushesSince: sql`case
        when (${REPOSTO}) > 0 then now()
        else ${matchDays.calendarPushesSince}
      end`,
    })
    .where(eq(matchDays.id, matchDayId))
    .returning({ pushes: matchDays.calendarPushes });

  return (linha?.pushes ?? 0) <= LIMITE_PUSHES_AGENDA_DIA;
}
