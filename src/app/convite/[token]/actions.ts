"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { invites, players, users } from "@/db/schema";
import { createSessionToken } from "@/lib/auth";
import { parseEmailDeContato, parseEmailDeContatoOpcional } from "@/lib/email-contato";
import { temEmailDeDestino } from "@/lib/email-destino";
import { hashPassword } from "@/lib/password";
import { platformAdminsDoAmbiente } from "@/lib/platform-admins";
import { setSessionCookie } from "@/lib/session";
import { USERNAME_REGEX } from "@/lib/username";

export type ClaimState = { error?: string };

const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    USERNAME_REGEX,
    "Nome de usuário inválido: use 2 a 20 caracteres entre letras minúsculas, números, ponto, hífen ou _.",
  );

const passwordSchema = z
  .string()
  .min(6, "A senha precisa de pelo menos 6 caracteres.")
  .max(100, "Senha longa demais.");

// O drizzle embrulha o erro do driver (DrizzleQueryError → cause) — percorre a
// cadeia de cause atrás do código 23505 do Postgres.
function isUniqueViolation(error: unknown): boolean {
  while (typeof error === "object" && error !== null) {
    if ("code" in error && error.code === "23505") return true;
    error = (error as { cause?: unknown }).cause;
  }
  return false;
}

// Resgata um convite: cria a conta do jogador ou, se ela já existe, redefine a
// senha (ter gerado o convite é a autorização — inclusive reativa a
// conta). Tudo é revalidado aqui dentro; o GET da página não vale nada no POST.
export async function claimInvite(
  token: string,
  _prev: ClaimState,
  formData: FormData,
): Promise<ClaimState> {
  const tokenParsed = z.string().min(1).max(100).safeParse(token);
  if (!tokenParsed.success) return { error: "Convite inválido ou expirado." };

  const [invite] = await db.select().from(invites).where(eq(invites.token, tokenParsed.data));
  if (!invite || invite.usedAt !== null || invite.expiresAt.getTime() <= Date.now()) {
    return { error: "Convite inválido ou expirado. Fala com quem te convidou para gerar outro." };
  }
  // Sem isto o vínculo estrito com o e-mail não valeria nada: quem pegasse o
  // link no grupo criaria a conta por senha e pularia a conferência do Google.
  // A página já esconde o formulário neste caso; esta é a trava de verdade.
  if (invite.email !== null) {
    return { error: "Este convite é de acesso pelo Google — use o botão do Google no link." };
  }

  const [player] = await db.select().from(players).where(eq(players.id, invite.playerId));
  if (!player || !player.active) return { error: "Jogador inativo — fala com o admin da plataforma." };

  const passwordParsed = passwordSchema.safeParse(formData.get("password"));
  if (!passwordParsed.success) return { error: passwordParsed.error.issues[0].message };
  if (passwordParsed.data !== formData.get("confirm")) {
    return { error: "As senhas não coincidem." };
  }

  const [existingUser] = await db.select().from(users).where(eq(users.playerId, invite.playerId));

  // Este é o único momento em que temos a pessoa na frente do formulário: um
  // convite sem e-mail é resgatado por quem o admin não sabe o endereço, e não
  // existe outra tela obrigatória depois. Por isso quem ainda não tem para onde
  // receber aviso preenche agora — e quem já tem (a conta de Google, ou um
  // contato de um resgate anterior) não redigita nada.
  //
  // O parse vem antes do hashPassword de propósito: scrypt custa dezenas de
  // milissegundos, e não vale pagar por um formulário que vai ser recusado.
  const precisaDeEmail = !existingUser || !temEmailDeDestino(existingUser);
  const contato = precisaDeEmail
    ? parseEmailDeContato(formData.get("contactEmail"))
    : parseEmailDeContatoOpcional(formData.get("contactEmail"));
  if (!contato.ok) return { error: contato.erro };

  const passwordHash = await hashPassword(passwordParsed.data);
  const usedAt = new Date();

  let sub: number;
  let tokenVersion: number;

  if (existingUser) {
    // Reset de senha: token_version novo derruba as sessões antigas.
    tokenVersion = existingUser.tokenVersion + 1;
    sub = existingUser.id;
    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({
          passwordHash,
          tokenVersion,
          active: true,
          // Spread condicional: no reset o campo é opcional, e gravar `null`
          // cru apagaria o endereço que a conta já tinha.
          ...(contato.email !== null && { contactEmail: contato.email }),
        })
        .where(eq(users.id, existingUser.id));
      await tx.update(invites).set({ usedAt }).where(eq(invites.id, invite.id));
    });
  } else {
    const usernameParsed = usernameSchema.safeParse(formData.get("username"));
    if (!usernameParsed.success) return { error: usernameParsed.error.issues[0].message };
    // Os nomes de PLATFORM_ADMIN_USERNAMES não são de quem chegar primeiro: a
    // env var dá admin pelo username, então deixar um estranho escolher um nome
    // da lista entregaria a plataforma. O `npm run build` já cria essas contas
    // (ver provisionarPlatformAdmins), e esta é a segunda tranca — vale para a
    // janela entre alguém editar a env var na Vercel e o build seguinte rodar.
    if (platformAdminsDoAmbiente().has(usernameParsed.data)) {
      return { error: "Esse nome de usuário não está disponível." };
    }
    try {
      const created = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(users)
          // `email` continua fora do insert, e é essa ausência que mantém a
          // conta invisível para o login pelo Google (ver decidirPorContas em
          // src/lib/regras-login-google.ts): o endereço que a pessoa acabou de
          // digitar é contato, não credencial.
          .values({
            playerId: invite.playerId,
            username: usernameParsed.data,
            passwordHash,
            contactEmail: contato.email,
          })
          .returning();
        await tx.update(invites).set({ usedAt }).where(eq(invites.id, invite.id));
        return row;
      });
      sub = created.id;
      tokenVersion = created.tokenVersion;
    } catch (error) {
      if (isUniqueViolation(error)) return { error: "Esse nome de usuário já está em uso." };
      throw error;
    }
  }

  // O cookie não carrega papel: quem é admin da plataforma é decidido a cada
  // request pelo getSession, lendo a flag do banco e a env var. Quem resgata um
  // convite de conta que já é admin sai daqui admin, sem nada a mais aqui.
  await setSessionCookie(await createSessionToken({ sub, v: tokenVersion }));
  redirect("/");
}
