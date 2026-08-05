"use server";

import { redirect } from "next/navigation";
import { createSessionToken } from "@/lib/auth";
import { setSessionCookie } from "@/lib/session";

export type LoginState = { error?: string };

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    // Sem a var, toda tentativa falharia com "senha incorreta" — mensagem que
    // manda o admin caçar a senha certa em vez de configurar o ambiente.
    return { error: "ADMIN_PASSWORD não configurada no servidor." };
  }

  const password = formData.get("password");
  if (typeof password !== "string" || password.length === 0 || password !== expected) {
    return { error: "Senha incorreta." };
  }

  await setSessionCookie(await createSessionToken({ role: "admin" }));
  redirect("/admin");
}
