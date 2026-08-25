"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { invites, players, users } from "@/db/schema";
import { criarJogadorComConvite, gerarConvite, parseEmailDeConvite } from "@/lib/convites";
import { isUniqueViolation } from "@/lib/db-errors";
import { parseEmailDeContatoOpcional } from "@/lib/email-contato";
import { enviarConvitePorEmail } from "@/lib/email-convite";
import { requirePlatformAdmin } from "@/lib/require-platform-admin";
import { redirectPosEnvio } from "@/app/redirect-pos-envio";

// O regex barra quebra de linha no meio do nome (o `.trim()` só corta as
// pontas), pelo mesmo motivo do nome de grupo em grupos-form.ts: nome e apelido
// viram o CN do ATTENDEE no .ics do convite de agenda (ver agenda.ts), e ali uma
// quebra encerraria a linha. O gerador também se defende; recusar na entrada é a
// camada que impede o lixo de chegar ao banco.
const SEM_QUEBRA = /^[^\r\n]+$/;

const playerSchema = z.object({
  name: z.string().trim().min(1, "Nome é obrigatório").max(60).regex(SEM_QUEBRA),
  nickname: z
    .string()
    .trim()
    .max(60)
    .refine((v) => v === "" || SEM_QUEBRA.test(v))
    .transform((v) => (v === "" ? null : v)),
  isGoalkeeper: z.coerce.boolean(),
});

// Todo id deste arquivo vem do `.bind`, ou seja, do corpo do POST. Fica no topo
// porque agora não há mais action aqui que dispense o parse.
const idSchema = z.number().int().positive();

function parsePlayerForm(formData: FormData) {
  return playerSchema.safeParse({
    name: formData.get("name") ?? "",
    nickname: formData.get("nickname") ?? "",
    isGoalkeeper: formData.get("isGoalkeeper") === "on",
  });
}

// Cadastrar já cria o convite (ver src/lib/convites.ts) e, com email, já o
// envia; o botão de gerar convite segue existindo para reenviar quando o prazo
// vencer.
export async function createPlayer(formData: FormData) {
  const session = await requirePlatformAdmin();
  const parsed = parsePlayerForm(formData);
  if (!parsed.success) redirect("/admin/jogadores?erro=dados-invalidos");
  const email = parseEmailDeConvite(formData.get("email"));
  if (!email.success) redirect("/admin/jogadores?erro=email-invalido");

  let criado: { token: string };
  try {
    criado = await db.transaction((tx) =>
      // O criador entra aqui também: a coluna é auditoria de quem tomou o nome,
      // e o admin da plataforma não é exceção a isso — só ao teto.
      criarJogadorComConvite(tx, {
        ...parsed.data,
        email: email.data,
        createdByPlayerId: session.player.id,
      }),
    );
  } catch (error) {
    if (isUniqueViolation(error)) redirect("/admin/jogadores?erro=nome-duplicado");
    throw error;
  }

  // O envio fica fora da transação: falha de email não desfaz o cadastro, e um
  // rollback depois do envio mandaria um convite que não existe.
  const envio = email.data ? await enviarConvitePorEmail(criado.token) : null;
  revalidatePath("/admin/jogadores");
  if (envio) redirectPosEnvio("/admin/jogadores", envio);
  redirect("/admin/jogadores");
}

export async function updatePlayer(playerId: number, formData: FormData) {
  await requirePlatformAdmin();
  // O `idSchema` que os vizinhos deste arquivo já usam. Faltava só aqui e no
  // setPlayerActive, e a diferença aparece quando o id não é inteiro: erro cru
  // do driver em vez do redirect que o resto da tela produz.
  const id = idSchema.parse(playerId);
  const parsed = parsePlayerForm(formData);
  if (!parsed.success) redirect("/admin/jogadores?erro=dados-invalidos");

  try {
    await db.update(players).set(parsed.data).where(eq(players.id, id));
  } catch (error) {
    if (isUniqueViolation(error)) redirect("/admin/jogadores?erro=nome-duplicado");
    throw error;
  }
  revalidatePath("/admin/jogadores");
  redirect("/admin/jogadores");
}

export async function setPlayerActive(playerId: number, active: boolean) {
  await requirePlatformAdmin();
  // `active` passa pelo mesmo `z.boolean().parse` do setUserActive: os dois
  // recebem o valor do corpo do POST, e um "false" string viraria `true`.
  await db
    .update(players)
    .set({ active: z.boolean().parse(active) })
    .where(eq(players.id, idSchema.parse(playerId)));
  revalidatePath("/admin/jogadores");
}

// Convite para quem já tem conta é reset de senha — por isso esta action é
// exclusiva da plataforma. É o único caminho que chega em `gerarConvite` com um
// jogador que pode já ter conta; o do admin do fut só cria jogador novo. O
// email também muda de texto nesse caso: quem já é do app não recebe boas-vindas
// (ver emailDeResetDeAcesso, escolhido dentro de enviarConvitePorEmail).
export async function createInvite(playerId: number, formData: FormData) {
  await requirePlatformAdmin();
  const id = idSchema.parse(playerId);
  const [player] = await db.select().from(players).where(eq(players.id, id));
  if (!player || !player.active) return;
  const email = parseEmailDeConvite(formData.get("email"));
  if (!email.success) redirect("/admin/jogadores?erro=email-invalido");

  const token = await db.transaction((tx) => gerarConvite(tx, id, email.data));
  const envio = email.data ? await enviarConvitePorEmail(token) : null;
  revalidatePath("/admin/jogadores");
  if (envio) redirectPosEnvio("/admin/jogadores", envio);
}

/**
 * Reenvia por email o convite pendente do jogador — sem reemitir: o token
 * continua o mesmo, então um link já entregue no WhatsApp segue valendo.
 * Convite vencido, resgatado ou sem email não se reenvia; para esses o caminho
 * é o botão de gerar convite, que troca o token.
 *
 * O select aqui só acha o token do convite pendente (`usedAt is null`). Quem diz
 * se ele ainda serve para email — não vencido, com destinatário — é
 * `enviarConvitePorEmail`, que é dono dessa regra e devolve `convite-inelegivel`
 * para o mesmo banner.
 */
export async function reenviarConvitePorEmail(playerId: number) {
  await requirePlatformAdmin();
  const id = idSchema.parse(playerId);

  const [invite] = await db
    .select({ token: invites.token })
    .from(invites)
    .where(and(eq(invites.playerId, id), isNull(invites.usedAt)));
  if (!invite) redirect("/admin/jogadores?erro=convite-nao-reenviavel");

  const envio = await enviarConvitePorEmail(invite.token);
  revalidatePath("/admin/jogadores");
  redirectPosEnvio("/admin/jogadores", envio);
}

export async function revokeInvite(playerId: number) {
  await requirePlatformAdmin();
  const id = idSchema.parse(playerId);
  await db.delete(invites).where(and(eq(invites.playerId, id), isNull(invites.usedAt)));
  revalidatePath("/admin/jogadores");
}

// Desativar a conta derruba a sessão no próximo request (o DAL re-checa
// users.active a cada request) — não precisa mexer em token_version.
export async function setUserActive(userId: number, active: boolean) {
  await requirePlatformAdmin();
  const id = idSchema.parse(userId);
  await db.update(users).set({ active: z.boolean().parse(active) }).where(eq(users.id, id));
  revalidatePath("/admin/jogadores");
}

/**
 * Grava à mão o e-mail em que o jogador recebe aviso.
 *
 * Existe para os endereços que o admin já conhece — o auto-serviço (o pedido
 * que aparece no app, ver salvarEmailDeContato) depende de a pessoa entrar, e
 * há conta que não entra faz meses.
 *
 * Escreve em `contact_email`, nunca em `email`: aquele é credencial do login
 * pelo Google (ver decidirPorContas em src/lib/regras-login-google.ts), e um
 * admin digitando lá promoveria um palpite a chave de acesso. Em branco limpa —
 * é como se desfaz um endereço digitado errado, sem precisar de outro botão.
 */
export async function definirEmailDeContato(userId: number, formData: FormData) {
  await requirePlatformAdmin();
  const id = idSchema.parse(userId);

  const contato = parseEmailDeContatoOpcional(formData.get("contactEmail"));
  if (!contato.ok) redirect("/admin/jogadores?erro=email-contato-invalido");

  await db.update(users).set({ contactEmail: contato.email }).where(eq(users.id, id));
  revalidatePath("/admin/jogadores");
}

/**
 * Promove ou rebaixa um admin da plataforma.
 *
 * Existe porque só havia caminho de ida: o `npm run build` liga a flag de quem
 * está em `PLATFORM_ADMIN_USERNAMES` e nunca desliga, então uma conta que
 * virasse admin ficaria admin para sempre — tirar o username da env var não
 * rebaixa, porque a flag já está gravada. Sem isto, o único jeito de conter um
 * admin comprometido era desativar a conta inteira, o que é bem mais do que
 * tirar o papel.
 *
 * Vale já no request seguinte, sem derrubar a sessão: o papel é lido do banco a
 * cada request pelo getSession, não do cookie.
 *
 * Rebaixar a si mesmo é recusado: seria um tiro no pé silencioso, e alguém
 * precisa sobrar com a chave. Quem está na env var não é rebaixável pela flag —
 * a env var é chave-mestra e vence o banco (ver src/lib/session.ts).
 */
export async function setPlatformAdmin(userId: number, isPlatformAdmin: boolean) {
  const session = await requirePlatformAdmin();
  const id = idSchema.parse(userId);
  if (id === session.userId) redirect("/admin/jogadores?erro=auto-rebaixamento");

  await db
    .update(users)
    .set({ isPlatformAdmin: z.boolean().parse(isPlatformAdmin) })
    .where(eq(users.id, id));
  revalidatePath("/admin/jogadores");
}
