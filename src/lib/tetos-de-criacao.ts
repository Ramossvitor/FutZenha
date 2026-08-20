// Quantos futs, grupos e jogadores uma conta cria por dia.
//
// Sozinho, nada disto é vulnerabilidade — é o MULTIPLICADOR das outras. Criar
// fut é auto-servível por design (qualquer jogador logado marca um e vira admin
// dele), e disso saem três alavancas:
//
// - cada fut novo é um fan-out de aviso e um lote de e-mail de agenda com cota
//   própria (o freio de ./agenda-freio é por fut, então futs infinitos são
//   cotas infinitas);
// - `convidarParaFut` insere em `players` com nome à escolha, e `players.name` é
//   UNIQUE — cadastrar nome é TOMAR nome, inclusive um que ainda vai virar admin
//   (ver a trava de squat em src/db/platform-admins-bootstrap.ts);
// - grupo atrás de grupo estreia pares (grupo, jogador) novos, que é o contorno
//   que o dedupe do aviso de grupo sozinho não pega.
//
// Sem tabela nova, pelo mesmo princípio de ./freios-de-envio: a linha de domínio
// já registra quem criou e quando. São três `count` indexados
// (`*_criador_idx`), com a mesma forma `now() - make_interval(...)` que
// `tetoDiarioAtingido` usa.
//
// Os números são folgados de propósito. Não é cota de uso, é teto de sanidade:
// quem organiza de verdade marca um a três futs por semana, e nenhum destes
// encosta em uso legítimo.

import "server-only";
import { and, count, eq, gt, sql, type SQLWrapper } from "drizzle-orm";
import { db } from "@/db";
import { groups, matchDays, players } from "@/db/schema";
import type { Ator } from "./permissions";

export const TETO_FUTS_POR_DIA = 10;
export const TETO_GRUPOS_POR_DIA = 5;
/** Dois elencos inteiros num dia — o seed tem 18 jogadores. */
export const TETO_JOGADORES_POR_DIA = 20;

const JANELA_HORAS = 24;

async function criadosNoDia(
  tabela: typeof matchDays | typeof groups | typeof players,
  criador: SQLWrapper,
  criadoEm: SQLWrapper,
  playerId: number,
): Promise<number> {
  const [linha] = await db
    .select({ total: count() })
    .from(tabela)
    .where(
      and(
        eq(criador, playerId),
        gt(criadoEm, sql`now() - make_interval(hours => ${JANELA_HORAS})`),
      ),
    );
  return linha?.total ?? 0;
}

/**
 * O ator pode criar mais um destes agora?
 *
 * O admin da plataforma passa por cima — ele é quem conserta as coisas, e um
 * teto que trave o conserto é pior que teto nenhum. É a mesma isenção que
 * `podeGerenciarFut` e `podeDefinirPresencaPor` já fazem.
 */
export async function podeCriarMaisFut(ator: Ator): Promise<boolean> {
  if (ator.isPlatformAdmin) return true;
  return (
    (await criadosNoDia(matchDays, matchDays.createdByPlayerId, matchDays.createdAt, ator.playerId)) <
    TETO_FUTS_POR_DIA
  );
}

export async function podeCriarMaisGrupo(ator: Ator): Promise<boolean> {
  if (ator.isPlatformAdmin) return true;
  return (
    (await criadosNoDia(groups, groups.createdByPlayerId, groups.createdAt, ator.playerId)) <
    TETO_GRUPOS_POR_DIA
  );
}

export async function podeCriarMaisJogador(ator: Ator): Promise<boolean> {
  if (ator.isPlatformAdmin) return true;
  return (
    (await criadosNoDia(players, players.createdByPlayerId, players.createdAt, ator.playerId)) <
    TETO_JOGADORES_POR_DIA
  );
}
