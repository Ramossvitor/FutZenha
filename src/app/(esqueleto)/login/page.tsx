import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Banner } from "@/components/ui/banner";
import { CartaoDeEntrada, Divisor } from "@/components/ui/cartao-de-entrada";
import { GoogleButton } from "@/components/ui/google-button";
import { mensagemDeErro } from "@/lib/erros-login";
import { googleLoginConfigurado } from "@/lib/google-oauth";
import { getSession } from "@/lib/session";
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
    <CartaoDeEntrada
      titulo="Entrar"
      descricao="Não tem cadastro aberto: quem entra aqui foi convidado por quem organiza o fut."
      rodape={
        <>
          Perdeu o acesso? Quem administra gera um link novo.{" "}
          <Link href="/guia" className="text-accent-ink hover:underline">
            Como o FutZenha funciona
          </Link>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {erroMensagem && <Banner tom="erro">{erroMensagem}</Banner>}

        {googleLoginConfigurado() && (
          <>
            <GoogleButton href={hrefGoogle} />
            {/* A senha continua aqui enquanto houver conta que só entra por
                ela. Quando todo mundo tiver vinculado o Google, o formulário
                sai. */}
            <Divisor>ou com usuário e senha</Divisor>
          </>
        )}

        <LoginForm next={proximo} />
      </div>
    </CartaoDeEntrada>
  );
}
