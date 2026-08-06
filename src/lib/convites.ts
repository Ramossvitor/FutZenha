import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
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
export async function gerarConvite(
  exec: Executor,
  playerId: number,
  // Com email, o convite é de Google e só aquele endereço o resgata (ver
  // src/lib/google-login.ts). Sem, é o convite antigo de usuário e senha.
  email: string | null = null,
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await exec.delete(invites).where(and(eq(invites.playerId, playerId), isNull(invites.usedAt)));
  await exec.insert(invites).values({
    token,
    playerId,
    email,
    expiresAt: new Date(Date.now() + INVITE_DURATION_MS),
  });
  return token;
}

/**
 * Cadastra o jogador já com o convite a caminho — ninguém nasce sem acesso.
 */
export async function criarJogadorComConvite(
  exec: Executor,
  dados: { name: string; nickname: string | null; isGoalkeeper: boolean; email?: string | null },
): Promise<{ playerId: number; token: string }> {
  const { email = null, ...jogador } = dados;
  const [created] = await exec.insert(players).values(jogador).returning();
  const token = await gerarConvite(exec, created.id, email);
  return { playerId: created.id, token };
}

const emailSchema = z.preprocess(
  (v) => (typeof v === "string" ? v.trim().toLowerCase() : v),
  z.email("E-mail inválido.").max(160),
);

/**
 * O campo de e-mail do formulário de convite, vazio inclusive.
 *
 * Vazio não é erro: é o convite antigo, de usuário e senha, que segue valendo
 * enquanto a migração para o Google não termina. Fica aqui, e não em cada
 * action, porque são dois formulários (plataforma e pelada) e a normalização
 * para minúsculas é o que faz o convite casar com o que o Google devolve.
 */
export function parseEmailDeConvite(
  valor: FormDataEntryValue | null,
): { success: true; data: string | null } | { success: false } {
  if (typeof valor !== "string" || valor.trim() === "") return { success: true, data: null };
  const parsed = emailSchema.safeParse(valor);
  return parsed.success ? { success: true, data: parsed.data } : { success: false };
}
