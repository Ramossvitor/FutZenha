import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { type Executor } from "@/db";
import { invites, players } from "@/db/schema";
import { emailSchema } from "./email-contato";
import { VALIDADE_CONVITE_MS } from "./regras";

// Sem guard de propósito: quem autoriza é a action. São dois caminhos com
// permissões diferentes chegando aqui — o admin da plataforma, em
// /admin/jogadores, e o admin do fut, trazendo gente nova para o fut dele.

/**
 * Gera um convite novo e apaga os pendentes anteriores do jogador: fica no
 * máximo um pendente por jogador.
 *
 * Para quem já tem conta, resgatar o convite funciona como reset de senha — por
 * isso só `createInvite`, exclusiva do admin da plataforma, chega aqui com um
 * jogador que possa ter conta; o caminho do admin do fut passa por
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
    expiresAt: new Date(Date.now() + VALIDADE_CONVITE_MS),
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

/**
 * O campo de e-mail do formulário de convite, vazio inclusive.
 *
 * Vazio não é erro: é o convite antigo, de usuário e senha, que segue valendo
 * enquanto a migração para o Google não termina. Fica aqui, e não em cada
 * action, porque são dois formulários (plataforma e fut). A validação vem do
 * `emailSchema` compartilhado (src/lib/email-contato.ts), e é a normalização
 * dele para minúsculas que faz o convite casar com o que o Google devolve.
 */
export function parseEmailDeConvite(
  valor: FormDataEntryValue | null,
): { success: true; data: string | null } | { success: false } {
  if (typeof valor !== "string" || valor.trim() === "") return { success: true, data: null };
  const parsed = emailSchema.safeParse(valor);
  return parsed.success ? { success: true, data: parsed.data } : { success: false };
}
