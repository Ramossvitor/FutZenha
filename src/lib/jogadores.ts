import "server-only";
import { cache } from "react";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { players, users, type Player } from "@/db/schema";

/**
 * O jogador como o perfil público o mostra.
 *
 * É a linha de `players` inteira — não há o que esconder ali: nome, apelido,
 * nota, goleiro e ativo já aparecem em ranking, escalação e lista de membros.
 * O que NÃO entra aqui é `users`: e-mail, username e hash são credencial, e o
 * perfil público não tem por que carregá-los para depois lembrar de não
 * renderizá-los.
 */
export type PerfilJogador = Player & {
  /** Tem conta e ela está ativa — a mesma expressão do listarMembros. */
  temConta: boolean;
};

/**
 * Um jogador pelo id. `undefined` = não existe.
 *
 * `cache()` porque generateMetadata e o corpo da página perguntam o mesmo
 * jogador no mesmo render — sem isto seriam duas consultas idênticas, pelo
 * mesmo motivo do getGrupo em ./grupos.
 *
 * `leftJoin` (e não inner) de propósito: jogador sem conta existe e tem perfil.
 * Ele aparece na escalação e na artilharia de todo fut que jogou, então esconder
 * a página dele só criaria um link que às vezes dá 404.
 */
export const getJogador = cache(async (playerId: number): Promise<PerfilJogador | undefined> => {
  const [row] = await db
    .select({
      jogador: players,
      temConta: sql<boolean>`${users.id} is not null and ${users.active}`,
    })
    .from(players)
    .leftJoin(users, eq(users.playerId, players.id))
    .where(eq(players.id, playerId));

  return row && { ...row.jogador, temConta: row.temConta };
});
