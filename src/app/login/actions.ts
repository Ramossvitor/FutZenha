"use server";

import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createSessionToken, SESSION_COOKIE } from "@/lib/auth";
import {
  esquecerFalhasDeLogin,
  permitirTentativaDeLogin,
  registrarFalhaDeLogin,
} from "@/lib/freio-de-login";
import { GRUPO_COOKIE } from "@/lib/grupo-atual";
import { destinoSeguro } from "@/lib/oauth-state";
import { DUMMY_HASH, verifyPassword } from "@/lib/password";
import { setSessionCookie } from "@/lib/session";

export type LoginState = { error?: string };

// Os tetos existem para o que chega ANTES da senha ser conferida. `min(1)` diz
// "preenchido"; o `max` diz "não é payload". Sem ele, `password` seguia sem teto
// nenhum e um corpo de megabytes ia inteiro para o scrypt — que é justamente a
// operação cara desta action. O username tem o mesmo teto do USERNAME_REGEX com
// folga; nada legítimo chega perto.
const loginSchema = z.object({
  username: z.string().trim().toLowerCase().min(1).max(60),
  password: z.string().min(1).max(200),
  next: z.string().optional(),
});

// O erro é sempre o mesmo — com verificação contra hash dummy quando o usuário
// não existe — para o tempo de resposta não entregar quais usuários existem.
//
// O freio de tentativas (src/lib/freio-de-login.ts) é por instância e em
// memória, e é **otimização, não garantia**: o módulo explica por quê, e a
// defesa de verdade é da plataforma. O trabalho dele aqui é um só e é concreto:
// acima do teto, esta função devolve o mesmo erro genérico SEM tocar o banco e
// SEM pagar o scrypt. Antes disto, martelar um username conhecido custava zero
// ao atacante e 50–100 ms de CPU a cada tentativa para nós — e o username do
// admin é conhecido, porque o .env.example já o trouxe num repositório público.
export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    username: formData.get("username"),
    password: formData.get("password"),
    next: formData.get("next") ?? undefined,
  });
  if (!parsed.success) return { error: "Usuário ou senha incorretos." };
  const { username, password, next } = parsed.data;

  // Mesma mensagem do erro de senha, de propósito: dizer "muitas tentativas"
  // transformaria o freio num sinal, e o sinal mais barato de todos é o que
  // confirma que vale a pena continuar tentando naquele nome.
  if (!permitirTentativaDeLogin(username)) {
    return { error: "Usuário ou senha incorretos." };
  }

  const [user] = await db.select().from(users).where(eq(users.username, username));
  const passwordOk = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !passwordOk || !user.active) {
    registrarFalhaDeLogin(username);
    return { error: "Usuário ou senha incorretos." };
  }

  // Acertou: a chave sai do radar antes de qualquer outra coisa. Sem isto, quem
  // erra nove vezes e acerta na décima seguiria a um passo do bloqueio.
  esquecerFalhasDeLogin(username);
  await setSessionCookie(await createSessionToken({ sub: user.id, v: user.tokenVersion }));
  // A regra de destino interno é uma só, e mora no destinoSeguro — duas cópias
  // divergiriam, e a daqui já divergia: deixava passar a barra invertida.
  redirect(destinoSeguro(next));
}

export async function logout() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  // O grupo em que a pessoa navegava sai junto: num aparelho compartilhado,
  // quem entrar depois começaria vendo o nome do grupo — e os futs — de
  // quem saiu.
  store.delete(GRUPO_COOKIE);
  redirect("/");
}
