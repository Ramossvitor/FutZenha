import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { invites, players, users } from "@/db/schema";
import { createSessionToken } from "./auth";
import { isUniqueViolation } from "./db-errors";
import type { GoogleIdentity } from "./google-oauth";
import { conviteAutoriza, decidirPorContas, type ErroLogin } from "./regras-login-google";
import { comSufixo, sugerirUsername, variacaoDeUsername } from "./username";

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
// Os passos 3 a 5 e a conferência do convite vivem em src/lib/regras-login-google.ts,
// que não fala com o banco e por isso tem teste. Daqui para baixo é busca,
// gravação e as travas que só o banco garante (as unique de email e google_sub).

export type { ErroLogin };

export type ResultadoLogin =
  | { ok: true; token: string }
  | { ok: false; erro: ErroLogin; emailEsperado?: string };

type Conta = typeof users.$inferSelect;

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

  // As duas em paralelo: são independentes, e a decisão precisa das duas para
  // valer como uma decisão só.
  //
  // Busca pelo email cru, e não canônico: `users.email` só é gravado a partir do
  // que o Google devolve, então os dois lados aqui já vêm da mesma fonte — e é o
  // valor gravado que a unique protege.
  const [[porSub], [porEmail]] = await Promise.all([
    db.select().from(users).where(eq(users.googleSub, identidade.sub)),
    db.select().from(users).where(eq(users.email, identidade.email)),
  ]);

  const decisao = decidirPorContas(porSub, porEmail);
  switch (decisao.acao) {
    case "sessao":
      return sessaoDe(decisao.conta);
    case "vincular":
      return vincularAConta(decisao.userId, identidade);
    case "recusar":
      return { ok: false, ...decisao.recusa };
    case "convite":
      return resgatarConvite(identidade, pendente.t);
  }
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

// As numeradas primeiro porque são as legíveis (`pedro2`), e são o caso comum:
// dois ou três jogadores compartilhando o primeiro nome. Passando disso a
// numeração vira uma fila que depende de quantos vieram antes — seis Pedros
// esgotavam `pedro`…`pedro6` e derrubavam o login com um throw —, então o resto
// das tentativas sorteia um sufixo, que não depende de ninguém.
const TENTATIVAS_NUMERADAS = 3;
const TENTATIVAS_DE_USERNAME = 8;

function sufixoAleatorio(): string {
  const [n] = crypto.getRandomValues(new Uint32Array(1));
  return (n % 36 ** 4).toString(36).padStart(4, "0");
}

function candidatoDeUsername(base: string, tentativa: number): string {
  return tentativa <= TENTATIVAS_NUMERADAS
    ? variacaoDeUsername(base, tentativa)
    : comSufixo(base, sufixoAleatorio());
}

async function resgatarConvite(
  identidade: GoogleIdentity,
  token: string | undefined,
): Promise<ResultadoLogin> {
  if (!token) return { ok: false, erro: "sem-convite" };

  const [invite] = await db.select().from(invites).where(eq(invites.token, token));
  const autorizacao = conviteAutoriza(invite, identidade, Date.now());
  if (!autorizacao.ok) return { ok: false, ...autorizacao.recusa };

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
  // jogador e precisa sair livre sozinho — daí as variações.
  const base = sugerirUsername(player.name, player.nickname);
  for (let tentativa = 1; tentativa <= TENTATIVAS_DE_USERNAME; tentativa++) {
    const username = candidatoDeUsername(base, tentativa);
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
