import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { type Executor } from "@/db";
import { invites, players } from "@/db/schema";

// Espelhado em src/db/migrate.ts, que roda sob tsx e não carrega `server-only`.
const INVITE_DURATION_MS = 1000 * 60 * 60 * 24 * 7; // 7 dias

// Sem guard de propósito: quem autoriza é a action. São dois caminhos com
// permissões diferentes chegando aqui — o admin da plataforma, em
// /admin/jogadores, e o admin da pelada, trazendo gente nova para a pelada dele.

/**
 * Gera um convite novo e apaga os pendentes anteriores do jogador: fica no
 * máximo um pendente por jogador.
 *
 * Para quem já tem conta, resgatar o convite funciona como reset de senha — por
 * isso só `createInvite`, exclusiva do admin da plataforma, chega aqui com um
 * jogador que possa ter conta; o caminho do admin da pelada passa por
 * `criarJogadorComConvite`, que acabou de criar o jogador.
 */
export async function gerarConvite(exec: Executor, playerId: number): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await exec.delete(invites).where(and(eq(invites.playerId, playerId), isNull(invites.usedAt)));
  await exec.insert(invites).values({
    token,
    playerId,
    expiresAt: new Date(Date.now() + INVITE_DURATION_MS),
  });
  return token;
}

/**
 * Cadastra o jogador já com o convite a caminho — ninguém nasce sem acesso.
 * O link continua sendo entregue na mão (não há e-mail no projeto).
 */
export async function criarJogadorComConvite(
  exec: Executor,
  dados: { name: string; nickname: string | null; isGoalkeeper: boolean },
): Promise<{ playerId: number; token: string }> {
  const [created] = await exec.insert(players).values(dados).returning();
  const token = await gerarConvite(exec, created.id);
  return { playerId: created.id, token };
}

