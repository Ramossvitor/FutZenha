import "server-only";
import { and, eq, notInArray } from "drizzle-orm";
import type { Executor } from "@/db";
import { gamePlayers, games, players, users } from "@/db/schema";
import { avisoDeFutEncerrado, avisoDeFutEncerradoNoGrupo } from "./avisos-fut";
import { condicaoDeAviso } from "./elegiveis";
import { notificar } from "./notifications";
import type { RodadaAberta } from "./ratings-engine";

// Quem é avisado quando o fut encerra, e com que destino.
//
// Irmão com banco do ./encerramento (puro, que decide quem vira falta e monta o
// checklist da tela). Mora fora da action porque a pergunta "quem merece ser
// interrompido" já tem dono nesta base — ./elegiveis — e refazê-la na action
// seria a terceira definição de círculo social do projeto.

export type FutEncerrado = {
  id: number;
  date: string;
  location: string;
  groupId: number | null;
  createdByPlayerId: number | null;
};

/**
 * Um aviso por pessoa, dois públicos.
 *
 * - **Quem jogou** (`game_players`, e não `attendances`: é a autoridade que
 *   `marcarFaltasAutomaticas` e `getRatersElegiveis` já usam) recebe o aviso do
 *   encerramento. O destino muda: quem é avaliador elegível cai no formulário,
 *   que mostra o resumo antes das estrelas; quem jogou e não avalia — lado sem
 *   três contas ativas, ou fut sem rodada nenhuma — cai na página do fut. Sem
 *   essa distinção, metade do elenco receberia um link para um 404.
 * - **Quem não jogou** recebe o aviso curto, sem e-mail.
 *
 * Roda DENTRO da transação do encerramento, como o `abrirRodada`: notificar é
 * escrita, e uma pessoa que ficasse sem aviso porque o commit passou e o aviso
 * não seria um fut encerrado que ninguém soube. O e-mail é o contrário — sai
 * depois do commit, no `after()`, porque rede dentro de transação é a regra da
 * casa que não se quebra.
 *
 * Idempotente pela unique (playerId, dedupeKey) do `notificar`.
 */
export async function notificarEncerramento(
  exec: Executor,
  matchDay: FutEncerrado,
  rodada: RodadaAberta | null,
  atorId: number,
): Promise<void> {
  const jogaram = await exec
    .selectDistinct({ id: players.id })
    .from(gamePlayers)
    .innerJoin(games, eq(games.id, gamePlayers.gameId))
    .innerJoin(players, eq(players.id, gamePlayers.playerId))
    // Sem conta ativa não há caixa de entrada: o convidado que jogou e ainda não
    // resgatou o convite não recebe nada, aqui como no resto do app.
    .innerJoin(users, and(eq(users.playerId, players.id), eq(users.active, true)))
    .where(and(eq(games.matchDayId, matchDay.id), eq(players.active, true)));

  const jogaramIds = jogaram.map((j) => j.id);
  const avaliadores = new Set(rodada?.raters.map((r) => r.playerId) ?? []);

  const deFora = await exec
    .select({ id: players.id })
    .from(players)
    .innerJoin(users, and(eq(users.playerId, players.id), eq(users.active, true)))
    .where(
      and(
        eq(players.active, true),
        // O MESMO recorte do "marcaram fut". Em fut de grupo são os membros; em
        // fut avulso, quem já dividiu um fut com quem criou; em fut avulso órfão
        // (criador apagado), ninguém. Nunca `condicaoElegivel` cru: ela devolve
        // `undefined` em fut avulso, o `and()` do drizzle engole o termo em
        // silêncio e o aviso vaza para a plataforma inteira, com push junto.
        condicaoDeAviso(matchDay, matchDay.createdByPlayerId),
        // `notInArray` com lista vazia gera SQL inválido, e fut sem escalação
        // encerra normalmente — a guarda não é teórica.
        jogaramIds.length > 0 ? notInArray(players.id, jogaramIds) : undefined,
        // Quem acabou de clicar em "encerrar" não precisa ser avisado de que o
        // fut encerrou. Só vale para este balde: se essa pessoa JOGOU, ela
        // continua recebendo o aviso com o placar e a avaliação, que é outra
        // coisa. Mesmo espírito do avisoDeFutCriado, que pula quem marcou.
        notInArray(players.id, [atorId]),
      ),
    );

  // Quem recusou o convite ou tirou o próprio nome deste fut (ver
  // `recusouEsteFut` em ./presenca) NÃO é filtrado aqui, e a omissão é
  // deliberada: recusar um fut é dizer "não vou jogar", não "não quero saber do
  // grupo" — o placar de quinta continua sendo notícia do grupo.
  await notificar(exec, [
    ...jogaram.map((j) =>
      avisoDeFutEncerrado(matchDay, j.id, {
        href: rodada && avaliadores.has(j.id) ? `/avaliar/${rodada.roundId}` : `/fut/${matchDay.id}`,
        podeAvaliar: rodada !== null && avaliadores.has(j.id),
      }),
    ),
    ...deFora.map((p) => avisoDeFutEncerradoNoGrupo(matchDay, p.id)),
  ]);
}
