"use server";

import { redirect } from "next/navigation";
import { createSessionToken } from "@/lib/auth";
import { setSessionCookie } from "@/lib/session";

export type LoginState = { error?: string };

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const password = formData.get("password");
  if (typeof password !== "string" || password.length === 0 || password !== process.env.ADMIN_PASSWORD) {
    return { error: "Senha incorreta." };
  }

  await setSessionCookie(await createSessionToken({ role: "admin" }));
  redirect("/admin");
}
