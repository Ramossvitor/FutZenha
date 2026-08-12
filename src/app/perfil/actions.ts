"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { and, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { ratingReports, ratingRounds, ratings, users } from "@/db/schema";
import { createSessionToken } from "@/lib/auth";
import { isUniqueViolation } from "@/lib/db-errors";
import { parseEmailDeContato } from "@/lib/email-contato";
import {
  MOVIMENTO_COOKIE,
  MOVIMENTO_COOKIE_OPTIONS,
  parseMovimento,
} from "@/lib/movimento";
import { hashPassword, verifyPassword } from "@/lib/password";
import {
  MIN_AVALIACOES_PARA_DENUNCIAR,
  PRAZO_ADMIN_DIAS,
  prazoEmDias,
  resolverAvaliacaoPorIndice,
} from "@/lib/ratings";
import { requirePlayer } from "@/lib/require-player";
import { setSessionCookie } from "@/lib/session";

export type DenunciarState = { error?: string; success?: boolean };

const reasonSchema = z.string().trim().max(500).optional();

/**
 * Denuncia uma nota recebida. O jogador manda a POSIÇÃO na lista, não o id da
 * avaliação: `ratings.id` é serial e entregaria a ordem de envio. O servidor
 * repete a mesma ordenação anônima da tela para descobrir de qual avaliação se
 * trata.
 */
export async function denunciarAvaliacao(
  roundId: number,
  indice: number,
  _prev: DenunciarState,
  formData: FormData,
): Promise<DenunciarState> {
  const session = await requirePlayer();
  const parsedReason = reasonSchema.safeParse(formData.get("reason") ?? undefined);
  if (!parsedReason.success) return { error: "Motivo longo demais." };

  // A rodada precisa estar apurada e dentro do prazo de contestação.
  const [rodada] = await db
    .select({ id: ratingRounds.id })
    .from(ratingRounds)
    .where(
      and(
        eq(ratingRounds.id, roundId),
        eq(ratingRounds.status, "closed"),
        gt(ratingRounds.reportDeadlineAt, sql`now()`),
      ),
    );
  if (!rodada) return { error: "O prazo para contestar esta rodada já passou." };

  const recebidas = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(ratings)
    .where(and(eq(ratings.roundId, roundId), eq(ratings.ratedPlayerId, session.player.id)));
  if ((recebidas[0]?.total ?? 0) < MIN_AVALIACOES_PARA_DENUNCIAR) {
    return {
      error: `Só dá para reportar quando você recebeu ao menos ${MIN_AVALIACOES_PARA_DENUNCIAR} avaliações na rodada.`,
    };
  }

  // Uma denúncia por rodada, não uma por nota recebida. A unique em
  // rating_id sozinha só impede reportar a *mesma* nota duas vezes — sem esta
  // checagem dava para reportar todas as estrelas da rodada de uma vez e, com
  // o auto-aceite por silêncio do admin, anular o fut inteiro.
  const [jaDenunciou] = await db
    .select({ id: ratingReports.id })
    .from(ratingReports)
    .innerJoin(ratings, eq(ratingReports.ratingId, ratings.id))
    .where(
      and(
        eq(ratings.roundId, roundId),
        eq(ratingReports.reporterPlayerId, session.player.id),
      ),
    );
  if (jaDenunciou) return { error: "Você já reportou uma nota desta rodada." };

  const ratingId = await resolverAvaliacaoPorIndice(roundId, session.player.id, indice);
  if (ratingId === null) return { error: "Avaliação não encontrada." };

  try {
    await db.insert(ratingReports).values({
      ratingId,
      reporterPlayerId: session.player.id,
      // O .trim() do schema já é transform de saída no Zod 4.
      reason: parsedReason.data || null,
      adminDeadlineAt: prazoEmDias(PRAZO_ADMIN_DIAS),
    });
  } catch (error) {
    // Só a unique em rating_id vira mensagem. Qualquer outra falha (conexão
    // caída no cold start do Neon, FK) tem que subir: reportá-la como
    // duplicata faria o jogador desistir de um envio que nunca aconteceu.
    if (isUniqueViolation(error)) return { error: "Esta nota já foi reportada." };
    throw error;
  }

  revalidatePath("/perfil");
  return { success: true };
}

export type EmailDeContatoState = { error?: string; success?: boolean };

/**
 * Guarda o endereço em que a pessoa recebe aviso do fut.
 *
 * Escreve em `contact_email` e NUNCA em `email`: aquele é credencial — o login
 * pelo Google vincula uma conta ao endereço conhecido (ver decidirPorContas em
 * src/lib/regras-login-google.ts), e um campo de perfil que escrevesse lá
 * deixaria qualquer um digitar o Gmail de outra pessoa e capturar o vínculo.
 * Pelo mesmo motivo não mexe em `token_version`: contato não é credencial, e
 * mudá-lo não derruba as sessões abertas.
 *
 * O alvo é sempre `session.userId` — Server Action é endpoint HTTP público, e
 * um id vindo do formulário deixaria qualquer conta escrever na de outra.
 */
export async function salvarEmailDeContato(
  _prev: EmailDeContatoState,
  formData: FormData,
): Promise<EmailDeContatoState> {
  const session = await requirePlayer();

  const contato = parseEmailDeContato(formData.get("contactEmail"));
  if (!contato.ok) return { error: contato.erro };

  await db
    .update(users)
    .set({ contactEmail: contato.email })
    .where(eq(users.id, session.userId));

  // Só o perfil: o aviso no layout some por estado local, e revalidar o layout
  // inteiro invalidaria o app todo por causa de um campo.
  revalidatePath("/perfil");
  return { success: true };
}

export type ChangePasswordState = { error?: string; success?: boolean };

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Informe a senha atual."),
  newPassword: z
    .string()
    .min(6, "A nova senha precisa de pelo menos 6 caracteres.")
    .max(100, "Senha longa demais."),
  confirm: z.string(),
});

export async function changePassword(
  _prev: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  const session = await requirePlayer();

  const parsed = changePasswordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { currentPassword, newPassword, confirm } = parsed.data;
  if (newPassword !== confirm) return { error: "As senhas não coincidem." };

  // O hash nunca vive na sessão — re-busca aqui na hora de conferir.
  const [user] = await db.select().from(users).where(eq(users.id, session.userId));
  if (!user) return { error: "Conta não encontrada." };
  // Conta que nasceu pelo Google não tem senha para conferir. Definir uma aqui
  // seria criar credencial sem provar posse de nenhuma — quem quiser senha pede
  // um convite ao admin, que é o caminho que já existe para isso.
  if (user.passwordHash === null) {
    return { error: "Sua conta entra pelo Google e não tem senha." };
  }
  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    return { error: "Senha atual incorreta." };
  }

  const tokenVersion = user.tokenVersion + 1;
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(newPassword), tokenVersion })
    .where(eq(users.id, user.id));

  // token_version novo derruba as outras sessões; reemite o próprio cookie na
  // mesma action, senão este usuário se desloga sozinho no próximo request.
  await setSessionCookie(await createSessionToken({ sub: user.id, v: tokenVersion }));
  return { success: true };
}

/**
 * Liga, desliga ou devolve ao sistema as animações do app.
 *
 * `valor` chega pelo `.bind` — corpo do POST, portanto endereço de cliente — e
 * por isso passa pelo mesmo `parseMovimento` que o cookie sujo: qualquer coisa
 * fora dos três valores vira "auto" em silêncio em vez de carimbar lixo no
 * <html>.
 *
 * Sem sessão de propósito. Não há nada a proteger aqui: o cookie não é
 * credencial, não identifica ninguém, e exigir login faria a preferência sumir
 * justamente para quem está na tela de login com o movimento incomodando.
 *
 * Sem revalidatePath: mexer no cookie dentro de uma Server Action já marca o
 * request como revalidado, e o Next devolve o RSC novo na mesma resposta — a
 * mesma razão comentada em grupos/actions.ts.
 */
export async function definirMovimento(valor: string) {
  const store = await cookies();
  store.set(MOVIMENTO_COOKIE, parseMovimento(valor), MOVIMENTO_COOKIE_OPTIONS);
}
