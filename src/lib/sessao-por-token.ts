import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { players, users } from "@/db/schema";
import { montarSessao, type Session } from "./session";
import { extrairBearer, hashDoToken } from "./token-de-api";

/**
 * A sessão do relógio: quem é o dono do token de API que veio no header
 * `Authorization: Bearer …`. Irmã de `getSession` (./session.ts), com a mesma
 * saída — é `montarSessao` quem monta a `Session` nos dois caminhos — e três
 * diferenças de propósito:
 *
 * - **Nunca lê cookie.** A API do relógio é só Bearer: sem cookie não há CSRF
 *   (um site alheio não consegue anexar o header), e um browser logado não vira
 *   operador da súmula por acidente.
 * - **`active = true` no próprio WHERE.** Desativar a conta mata o token na
 *   hora, sem ninguém lembrar de apagar o hash — a mesma revogação automática
 *   que o guard da súmula aplica à delegação.
 * - **Ignora `token_version`.** Ele derruba SESSÕES ao trocar a senha; o
 *   relógio não é sessão, e cortá-lo é revogar o token no perfil. Do contrário,
 *   trocar a senha apagaria o atalho de quem está com a bola rolando.
 *
 * Só `src/app/api/sumula/**` importa daqui — é o que faz um token vazado não
 * valer para mais nada, e há um teste estrutural cobrando isso
 * (./sessao-por-token-so-na-api.test.ts).
 *
 * Grava `api_token_usado_em` a cada uso: uma escrita por request, irrisória
 * para o volume de uma súmula, e é o que o perfil mostra como "último uso" — a
 * prova de que o atalho chegou ao servidor.
 */
export async function sessaoPorToken(
  authorization: string | null | undefined,
): Promise<Session | null> {
  const token = extrairBearer(authorization);
  if (!token) return null;

  const [row] = await db
    .select({ user: users, player: players })
    .from(users)
    .innerJoin(players, eq(users.playerId, players.id))
    .where(and(eq(users.apiTokenHash, hashDoToken(token)), eq(users.active, true)));
  if (!row) return null;

  await db
    .update(users)
    .set({ apiTokenUsadoEm: sql`now()` })
    .where(eq(users.id, row.user.id));

  return montarSessao(row);
}
