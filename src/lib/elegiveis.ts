import "server-only";
import { and, asc, eq, exists, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { attendances, groupMembers, players, type Player } from "@/db/schema";

/**
 * Quem pode entrar na lista deste fut.
 *
 * Antes disto, as duas telas de presença liam `players.active = true` do banco
 * inteiro: um fut de grupo mostrava — e aceitava — todo jogador cadastrado
 * na plataforma. Isso funcionava quando só existia um grupo de fato; com grupos
 * de verdade, é vazamento de um grupo para o outro.
 *
 * - **Fut avulso** (`groupId` nulo): todo jogador ativo, que é como tudo
 *   funcionava antes dos grupos e continua funcionando.
 * - **Fut de grupo**: os membros do grupo.
 *
 * A união com quem já tem linha em `attendances` não é detalhe: sem ela, quem
 * confirmou e depois saiu do grupo sumiria da lista de um fut em que está —
 * e, encerrada o fut, sumiria da tela que o admin usa para conferir a
 * escalação de um jogo que a pessoa jogou.
 */
export type EscopoDaLista = { id: number; groupId: number | null };

/**
 * Já dividiu um fut com esta pessoa — a única relação que existe fora de grupo.
 *
 * É o recorte que substitui "a plataforma inteira" no fut avulso. Sai de
 * `attendances`, e não de `game_players`, de propósito: quem confirmou presença
 * junto já se conhece o bastante para receber um aviso, mesmo que um dos dois
 * tenha faltado no dia.
 */
export function condicaoJaJogouCom(playerId: number) {
  return exists(
    db
      .select({ um: sql`1` })
      .from(attendances)
      .innerJoin(
        alias(attendances, "minhas"),
        and(
          eq(sql`minhas.match_day_id`, attendances.matchDayId),
          eq(sql`minhas.player_id`, playerId),
        ),
      )
      .where(eq(attendances.playerId, players.id)),
  );
}

/**
 * Quem é AVISADO de um fut novo.
 *
 * Existe separado de `condicaoElegivel` porque as duas perguntas nunca foram a
 * mesma, e colá-las custou caro: *quem pode entrar* é uma coisa, *quem merece
 * ser interrompido* é outra. Em fut de grupo elas coincidem (os membros), mas em
 * fut avulso `condicaoElegivel` devolve `undefined` — e um `undefined` dentro de
 * `and()` é descartado em silêncio pelo drizzle, então o aviso de "marcaram
 * fut" saía para **todo jogador ativo da plataforma**, com push junto, a cada
 * fut avulso criado por qualquer pessoa.
 *
 * Nunca devolve `undefined`, e é isso que o teste unitário crava: é a ausência
 * de retorno, não o valor errado, que produz a falha silenciosa.
 */
export function condicaoDeAviso(matchDay: EscopoDaLista, criadorId: number | null) {
  if (matchDay.groupId !== null) return condicaoElegivel(matchDay)!;
  // Fut avulso órfão (criador apagado — a FK é `set null`) não tem círculo a
  // quem avisar. `false` explícito, e não `undefined`: era exatamente o
  // `undefined` engolido pelo `and()` que fazia isto virar "avise todo mundo".
  return criadorId === null ? sql`false` : condicaoJaJogouCom(criadorId);
}

/**
 * A condição em forma de SQL, para quem precisa compor com a própria consulta —
 * a tela de encerrar junta o `users` para saber quem tem conta, e refazer o
 * join aqui só para ela seria carregar a lista duas vezes.
 */
export function condicaoElegivel(matchDay: EscopoDaLista) {
  if (matchDay.groupId === null) return undefined;

  const ehMembro = exists(
    db
      .select({ um: sql`1` })
      .from(groupMembers)
      .where(
        and(eq(groupMembers.groupId, matchDay.groupId), eq(groupMembers.playerId, players.id)),
      ),
  );
  const jaEstaNaLista = exists(
    db
      .select({ um: sql`1` })
      .from(attendances)
      .where(and(eq(attendances.matchDayId, matchDay.id), eq(attendances.playerId, players.id))),
  );
  return or(ehMembro, jaEstaNaLista);
}

export async function jogadoresElegiveis(matchDay: EscopoDaLista): Promise<Player[]> {
  return db
    .select()
    .from(players)
    .where(and(eq(players.active, true), condicaoElegivel(matchDay)))
    .orderBy(asc(players.name));
}

/**
 * A mesma regra para uma pessoa só.
 *
 * As Server Actions recebem `playerId` do cliente e não podem depender de a tela
 * ter oferecido a opção certa — Server Action é endpoint público e não passa
 * pelo proxy (node_modules/next/dist/docs/01-app/02-guides/data-security.md).
 * Carregar a lista inteira só para testar um id seria desperdício em grupo
 * grande, então esta é uma consulta própria e não um `.some()` sobre a outra.
 */
export async function ehElegivel(matchDay: EscopoDaLista, playerId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: players.id })
    .from(players)
    .where(and(eq(players.id, playerId), eq(players.active, true), condicaoElegivel(matchDay)));
  return row !== undefined;
}
