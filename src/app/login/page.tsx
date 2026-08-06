import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Entrar" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  if (await getSession()) redirect("/");
  const { next } = await searchParams;

  return (
    <div className="mx-auto mt-16 w-full max-w-sm rounded-xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
      <h1 className="mb-1 text-xl font-bold">Entrar</h1>
      <p className="mb-4 text-sm text-neutral-600 dark:text-neutral-400">
        Ainda sem conta? Pede um convite a quem organiza a pelada.
      </p>
      <LoginForm next={typeof next === "string" ? next : undefined} />
    </div>
  );
}
