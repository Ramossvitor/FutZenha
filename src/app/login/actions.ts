"use server";

import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createSessionToken, SESSION_COOKIE } from "@/lib/auth";
import { GRUPO_COOKIE } from "@/lib/grupo-atual";
import { destinoSeguro } from "@/lib/oauth-state";
import { DUMMY_HASH, verifyPassword } from "@/lib/password";
import { setSessionCookie } from "@/lib/session";

export type LoginState = { error?: string };

const loginSchema = z.object({
  username: z.string().trim().toLowerCase().min(1),
  password: z.string().min(1),
  next: z.string().optional(),
});

// Sem rate limiting, de propósito: app de um grupo fechado de amigos e o plano
// gratuito não tem estado compartilhado entre instâncias para contar tentativas.
// O custo do scrypt (~50–100 ms por verificação) já freia força bruta, e o erro
// é sempre o mesmo — com verificação contra hash dummy quando o usuário não
// existe — para o tempo de resposta não entregar quais usuários existem.
export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    username: formData.get("username"),
    password: formData.get("password"),
    next: formData.get("next") ?? undefined,
  });
  if (!parsed.success) return { error: "Usuário ou senha incorretos." };
  const { username, password, next } = parsed.data;

  const [user] = await db.select().from(users).where(eq(users.username, username));
  const passwordOk = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !passwordOk || !user.active) {
    return { error: "Usuário ou senha incorretos." };
  }

  await setSessionCookie(await createSessionToken({ sub: user.id, v: user.tokenVersion }));
  // A regra de destino interno é uma só, e mora no destinoSeguro — duas cópias
  // divergiriam, e a daqui já divergia: deixava passar a barra invertida.
  redirect(destinoSeguro(next));
}

export async function logout() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  // O grupo em que a pessoa navegava sai junto: num aparelho compartilhado,
  // quem entrar depois começaria vendo o nome do grupo — e as peladas — de
  // quem saiu.
  store.delete(GRUPO_COOKIE);
  redirect("/");
}
