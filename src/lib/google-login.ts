import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { invites, players, users } from "@/db/schema";
import { createSessionToken } from "./auth";
import { isUniqueViolation } from "./db-errors";
import type { GoogleIdentity } from "./google-oauth";
import { sugerirUsername, variacaoDeUsername } from "./username";

// O que fazer com a identidade que voltou do Google. Toda a autorização do login
// pelo Google mora aqui — o route handler só transporta.
//
// A ordem das perguntas é a regra:
//
// 1. O email foi verificado pelo Google? Senão, nada feito.
// 2. É um vínculo pedido de dentro do /perfil? Então quem manda é a sessão atual.
// 3. Já conhecemos este `sub`? É login e acabou.
// 4. Conhecemos este *email* numa conta sem Google? É a conta de senha da pessoa
//    encontrando o Google pela primeira vez — vincula.
// 5. Não conhecemos ninguém: só entra com convite, e só com o email do convite.
//
// `sub` antes de email de propósito. O email é como as duas contas se encontram
// uma vez; depois disso o dono é o `sub`, que não muda quando a pessoa troca de
// email — e que não pode ser herdado por quem receber um endereço reciclado.

export type ErroLogin =
  | "email-nao-verificado"
  | "sem-convite"
  | "convite-invalido"
  | "convite-sem-email"
  | "email-nao-confere"
  | "jogador-inativo"
  | "conta-inativa"
  | "google-ja-vinculado";

export type ResultadoLogin =
  | { ok: true; token: string }
  | { ok: false; erro: ErroLogin; emailEsperado?: string };

type Conta = typeof users.$inferSelect;

/**
 * "vitor.ramos@gmail.com" → "vi•••@gmail.com".
 *
 * O suficiente para a pessoa reconhecer a própria conta e trocar de login, sem
 * entregar o endereço inteiro a quem apenas interceptou o link no grupo.
 */
export function mascararEmail(email: string): string {
  const [local, dominio] = email.split("@");
  if (!dominio) return "•••";
  return `${local.slice(0, 2)}•••@${dominio}`;
}

async function sessaoDe(user: Conta): Promise<ResultadoLogin> {
  if (!user.active) return { ok: false, erro: "conta-inativa" };
  return { ok: true, token: await createSessionToken({ sub: user.id, v: user.tokenVersion }) };
}

export async function resolverLoginGoogle(
  identidade: GoogleIdentity,
  pendente: { t?: string; link?: number },
): Promise<ResultadoLogin> {
  // Sem esta checagem, um domínio Workspace mal configurado entrega um email que
  // ninguém provou possuir — e é o email que casa com o convite.
  if (!identidade.emailVerified) return { ok: false, erro: "email-nao-verificado" };

  if (pendente.link !== undefined) return vincularAConta(pendente.link, identidade);

  const [porSub] = await db.select().from(users).where(eq(users.googleSub, identidade.sub));
  if (porSub) return sessaoDe(porSub);

  const [porEmail] = await db.select().from(users).where(eq(users.email, identidade.email));
  if (porEmail) {
    // Mesmo email, outra conta Google: endereço que trocou de dono (só acontece
    // em domínio corporativo). Quem manda é o `sub` já vinculado.
    if (porEmail.googleSub !== null) return { ok: false, erro: "google-ja-vinculado" };
    return vincularAConta(porEmail.id, identidade);
  }

  return resgatarConvite(identidade, pendente.t);
}

/**
 * Vincula esta conta Google a um `users` que já existe — seja o vínculo pedido
 * no /perfil, seja o primeiro login de quem já tinha senha.
 *
 * Bumpa `token_version` porque vincular é mudar credencial: as sessões abertas
 * em outros aparelhos caem, como já caem numa troca de senha.
 */
async function vincularAConta(userId: number, identidade: GoogleIdentity): Promise<ResultadoLogin> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user || !user.active) return { ok: false, erro: "conta-inativa" };

  if (user.googleSub !== null && user.googleSub !== identidade.sub) {
    return { ok: false, erro: "google-ja-vinculado" };
  }

  const tokenVersion = user.tokenVersion + 1;
  try {
    await db
      .update(users)
      .set({ googleSub: identidade.sub, email: identidade.email, tokenVersion })
      .where(eq(users.id, userId));
  } catch (error) {
    // As unique de email e google_sub são a trava real contra roubar o acesso de
    // outra conta; o select acima é só para dar mensagem melhor no caso comum.
    if (isUniqueViolation(error)) return { ok: false, erro: "google-ja-vinculado" };
    throw error;
  }

  return { ok: true, token: await createSessionToken({ sub: userId, v: tokenVersion }) };
}

async function resgatarConvite(
  identidade: GoogleIdentity,
  token: string | undefined,
): Promise<ResultadoLogin> {
  if (!token) return { ok: false, erro: "sem-convite" };

  const [invite] = await db.select().from(invites).where(eq(invites.token, token));
  if (!invite || invite.usedAt !== null || invite.expiresAt.getTime() <= Date.now()) {
    return { ok: false, erro: "convite-invalido" };
  }
  // Convite antigo, de usuário e senha: não autoriza cadastro pelo Google. O
  // caminho dele continua sendo o formulário em /convite/[token].
  if (invite.email === null) return { ok: false, erro: "convite-sem-email" };
  if (invite.email !== identidade.email) {
    return { ok: false, erro: "email-nao-confere", emailEsperado: mascararEmail(invite.email) };
  }

  const [player] = await db.select().from(players).where(eq(players.id, invite.playerId));
  if (!player || !player.active) return { ok: false, erro: "jogador-inativo" };

  const usadoEm = new Date();

  // O jogador já tem conta (de senha, ou desativada): o convite vale como
  // autorização do admin para reconectá-la ao Google — mesmo papel que o convite
  // de senha já tinha ao permitir reset e reativar a conta.
  const [existente] = await db.select().from(users).where(eq(users.playerId, invite.playerId));
  if (existente) {
    const tokenVersion = existente.tokenVersion + 1;
    try {
      await db.transaction(async (tx) => {
        await tx
          .update(users)
          .set({
            googleSub: identidade.sub,
            email: identidade.email,
            tokenVersion,
            active: true,
          })
          .where(eq(users.id, existente.id));
        await tx.update(invites).set({ usedAt: usadoEm }).where(eq(invites.id, invite.id));
      });
    } catch (error) {
      if (isUniqueViolation(error)) return { ok: false, erro: "google-ja-vinculado" };
      throw error;
    }
    return { ok: true, token: await createSessionToken({ sub: existente.id, v: tokenVersion }) };
  }

  // Conta nova. Ninguém digita username aqui, então ele é derivado do nome do
  // jogador e precisa sair livre sozinho — daí as variações numeradas.
  const base = sugerirUsername(player.name, player.nickname);
  for (let tentativa = 1; tentativa <= 6; tentativa++) {
    const username = variacaoDeUsername(base, tentativa);
    const [ocupado] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, username));
    if (ocupado) continue;

    try {
      const criado = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(users)
          .values({
            playerId: invite.playerId,
            username,
            email: identidade.email,
            googleSub: identidade.sub,
            // Conta nascida pelo Google não tem senha, e nunca nasce admin da
            // plataforma — a flag é sempre concedida depois, e à mão.
            passwordHash: null,
          })
          .returning();
        await tx.update(invites).set({ usedAt: usadoEm }).where(eq(invites.id, invite.id));
        return row;
      });
      return sessaoDe(criado);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // Ou o username foi tomado entre o select e o insert, ou a pessoa clicou
      // duas vezes e a primeira já criou a conta. A segunda hipótese se confirma
      // sozinha: o `sub` agora existe.
      const [jaCriado] = await db.select().from(users).where(eq(users.googleSub, identidade.sub));
      if (jaCriado) return sessaoDe(jaCriado);
    }
  }

  throw new Error(`Não foi possível derivar um username livre a partir de "${base}".`);
}
