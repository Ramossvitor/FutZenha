import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { mensagemDeErro } from "@/lib/erros-login";
import { googleLoginConfigurado } from "@/lib/google-oauth";
import { getSession } from "@/lib/session";
import { GoogleButton } from "@/components/ui/google-button";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Entrar" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  if (await getSession()) redirect("/");
  const { next, erro, esperado } = await searchParams;
  const proximo = typeof next === "string" ? next : undefined;
  const erroMensagem = mensagemDeErro(erro, esperado);

  const hrefGoogle = proximo
    ? `/api/auth/google?next=${encodeURIComponent(proximo)}`
    : "/api/auth/google";

  return (
    <div className="mx-auto mt-16 w-full max-w-sm rounded-xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
      <h1 className="mb-1 text-xl font-bold">Entrar</h1>
      <p className="mb-4 text-sm text-neutral-600 dark:text-neutral-400">
        Ainda sem conta? Pede um convite a quem organiza a pelada.
      </p>

      {erroMensagem && (
        <p className="mb-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {erroMensagem}
        </p>
      )}

      {googleLoginConfigurado() && (
        <>
          <GoogleButton href={hrefGoogle} />
          {/* A senha continua aqui enquanto houver conta que só entra por ela.
              Quando todo mundo tiver vinculado o Google, o formulário sai. */}
          <div className="my-4 flex items-center gap-3 text-xs text-neutral-500">
            <span className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
            ou com usuário e senha
            <span className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
          </div>
        </>
      )}

      <LoginForm next={proximo} />
    </div>
  );
}
