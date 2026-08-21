import "server-only";
import { after } from "next/server";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  attendances,
  gamePlayers,
  games,
  matchDays,
  players,
  ratingRoundRaters,
  ratingRounds,
  users,
} from "@/db/schema";
import { contagensDoDia } from "./contagem-de-envios";
import { emailDeDestino } from "./email-destino";
import { emailConfigurado, enviarEmail } from "./email-envio";
import { emailDeResumoDoFut } from "./email-modelos";
import { TETO_DIARIO, TETO_RESUMO_DIA } from "./freios-de-envio";
import { PRAZO_AVALIACAO_HORAS } from "./regras";
import { getResumoDoFut } from "./resumo-do-fut";

// O e-mail com o placar do fut encerrado. Família `email-*`: o transporte é
// ./email-envio, o conteúdo é ./email-modelos, e este junta os dois com o banco.
//
// Sempre DEPOIS do commit do encerramento, nunca dentro da transação: são até
// 20 POSTs sequenciais, cada um segurando conexão, e rollback não "desenvia"
// e-mail que já chegou.

/**
 * Quanto esperar entre um envio e o outro.
 *
 * O free tier do Resend aceita ~2 req/s. Os outros fluxos mandam um e-mail por
 * vez e nunca esbarraram nisso; este manda o elenco inteiro de uma vez, e sem a
 * pausa o lote colhe `rate_limit_exceeded` do terceiro em diante — o que aciona
 * a retentativa de rajada do transporte (até ~5s por e-mail) e coloca o lote em
 * risco de ser cortado pelo maxDuration de 60s da rota. Meio segundo custa ~10s
 * num fut de 20 e mantém o lote abaixo do limite.
 */
const ESPERA_ENTRE_ENVIOS_MS = 500;

/**
 * A pausa de verdade, com a costura que os testes usam.
 *
 * `RESUMO_ESPERA_MS=0` no projeto `integration` do vitest.config.mts: um teste
 * que manda seis e-mails pagaria 2,5s de `setTimeout` REAL por cima do setup de
 * fixture e da transação do encerramento, contra o testTimeout de 5s. A pausa
 * existe contra o rate limit do Resend, e no teste o Resend é um `vi.fn()` —
 * não há limite a respeitar, só relógio a queimar.
 *
 * Lida a cada chamada, e não no import: é o que deixa `vi.stubEnv` funcionar
 * num teste que queira exercitar a pausa de propósito.
 *
 * A env é só para teste. Em produção ela não existe e o default vale — um valor
 * inválido também cai nele, porque `Number("")` é 0 e um envio sem pausa
 * nenhuma é exatamente o que não pode acontecer por engano.
 */
function esperaEntreEnvios(): number {
  const bruto = process.env.RESUMO_ESPERA_MS;
  if (bruto === undefined || bruto.trim() === "") return ESPERA_ENTRE_ENVIOS_MS;
  const ms = Number(bruto);
  return Number.isFinite(ms) && ms >= 0 ? ms : ESPERA_ENTRE_ENVIOS_MS;
}

function esperar(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Best-effort, como os carimbos irmãos: o e-mail já saiu, e falhar aqui custa
 *  um envio repetido — não um envio perdido. */
async function carimbarResumo(matchDayId: number, playerId: number): Promise<void> {
  await db
    .update(attendances)
    .set({ resumoEmailSentAt: sql`now()` })
    .where(and(eq(attendances.matchDayId, matchDayId), eq(attendances.playerId, playerId)))
    .catch((erro) => {
      console.error("[email-resumo] não marcou resumo_email_sent_at:", {
        matchDayId,
        playerId,
        erro,
      });
    });
}

async function enviarResumoDoFut(matchDayId: number): Promise<void> {
  // Sem key nem toca o banco — modo preview/dev, e o encerramento seguiu o fluxo
  // de sempre (o fut fechou, ninguém prometeu e-mail).
  if (!emailConfigurado()) return;

  const [fut] = await db
    .select({
      id: matchDays.id,
      date: matchDays.date,
      location: matchDays.location,
      status: matchDays.status,
    })
    .from(matchDays)
    .where(eq(matchDays.id, matchDayId));
  // Relê o estado na hora de enviar: entre o commit e o `after` o fut pode ter
  // sido apagado (votação de exclusão apaga a linha e cascateia).
  if (!fut || fut.status !== "finished") return;

  const resumo = await getResumoDoFut(db, matchDayId);
  // Fut encerrado sem jogo lançado não tem placar para resumir. Coerente com o
  // `marcarFaltasAutomaticas`, que também não faz nada sem jogo.
  if (resumo.jogos.length === 0) return;

  const [rodada] = await db
    .select({ id: ratingRounds.id })
    .from(ratingRounds)
    .where(eq(ratingRounds.matchDayId, matchDayId));

  const destinos = await db
    .selectDistinct({
      playerId: players.id,
      nome: sql<string>`coalesce(${players.nickname}, ${players.name})`,
      para: emailDeDestino(),
      // `left join` na tabela de avaliadores congelados: quem está lá recebe a
      // chamada para avaliar e cai no formulário; quem jogou e não está — lado
      // sem três contas ativas — recebe o mesmo resumo, sem a chamada.
      podeAvaliar: sql<boolean>`${ratingRoundRaters.playerId} is not null`,
    })
    .from(gamePlayers)
    .innerJoin(games, eq(games.id, gamePlayers.gameId))
    .innerJoin(players, eq(players.id, gamePlayers.playerId))
    .innerJoin(users, and(eq(users.playerId, players.id), eq(users.active, true)))
    // A presença é o ledger. `inner join` e não `left`: sem linha aqui não há
    // onde carimbar, e mandar sem carimbo é mandar de novo no próximo retry.
    .innerJoin(
      attendances,
      and(eq(attendances.matchDayId, matchDayId), eq(attendances.playerId, players.id)),
    )
    .leftJoin(
      ratingRoundRaters,
      and(
        eq(ratingRoundRaters.roundId, rodada?.id ?? -1),
        eq(ratingRoundRaters.playerId, players.id),
      ),
    )
    .where(
      and(
        eq(games.matchDayId, matchDayId),
        eq(players.active, true),
        // A idempotência do envio, e nada mais: quem já recebeu não recebe de
        // novo, seja num retry do `after` ou numa varredura futura.
        isNull(attendances.resumoEmailSentAt),
      ),
    );

  // Conta sem endereço nenhum (nem Google, nem contato) simplesmente não recebe.
  const comEndereco = destinos.filter((d) => d.para !== null);
  if (comEndereco.length === 0) return;

  // Tudo-ou-nada, e não "manda o que couber": metade do elenco com o placar na
  // caixa e a outra metade sem é o estado que ninguém consegue explicar no
  // grupo. Por isso os dois tetos olham o LOTE INTEIRO, e não cada envio.
  //
  // São dois porque protegem coisas diferentes. O da instalação é o limite do
  // Resend. O do resumo é a linha que impede o fluxo de maior volume do produto
  // de comer sozinho a cota do convite/redefinição de acesso — o único fluxo sem
  // alternativa. Ver TETO_RESUMO_DIA em ./freios-de-envio.
  const gasto = await contagensDoDia();
  const teto =
    gasto.total + comEndereco.length > TETO_DIARIO
      ? "da instalação"
      : gasto.resumo + comEndereco.length > TETO_RESUMO_DIA
        ? "do resumo"
        : null;
  if (teto !== null) {
    console.warn(`[email-resumo] o lote não cabe na cota ${teto} — nenhum e-mail deste fut:`, {
      matchDayId,
      destinos: comEndereco.length,
      gasto,
    });
    return;
  }

  for (const [indice, destino] of comEndereco.entries()) {
    if (indice > 0) await esperar(esperaEntreEnvios());

    const podeAvaliar = destino.podeAvaliar && rodada !== undefined;
    const resultado = await enviarEmail({
      para: destino.para!,
      ...emailDeResumoDoFut({
        nome: destino.nome,
        fut,
        resumo,
        href: podeAvaliar ? `/avaliar/${rodada!.id}` : `/fut/${fut.id}`,
        podeAvaliar,
        prazoHoras: PRAZO_AVALIACAO_HORAS,
      }),
    });

    if (resultado.ok) {
      await carimbarResumo(matchDayId, destino.playerId);
      continue;
    }
    // Sem carimbo: quem não recebeu continua elegível para uma próxima passada.
    console.error("[email-resumo] resumo não saiu:", {
      matchDayId,
      playerId: destino.playerId,
      motivo: resultado.motivo,
    });
  }
}

/**
 * Agenda o envio para depois da resposta. Chamado pelo `confirmarEncerramento`,
 * fora da transação.
 *
 * O `after` roda mesmo quando a action termina em `redirect()` — e é o caso
 * aqui. O `try/catch` dentro é obrigatório: rejeição não tratada lá derruba o
 * log da request inteira (ver src/lib/pendencias.ts), e o callback devolve a
 * promessa para o `waitUntil` da Vercel esticar a invocação até o fim do lote.
 */
export function agendarResumoDoFut(matchDayId: number): void {
  if (!emailConfigurado()) return;
  after(async () => {
    try {
      await enviarResumoDoFut(matchDayId);
    } catch (erro) {
      console.error("[email-resumo] envio do resumo falhou:", erro);
    }
  });
}
