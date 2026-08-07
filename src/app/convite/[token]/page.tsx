import type { Metadata } from "next";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { Banner } from "@/components/ui/banner";
import { LinkButton } from "@/components/ui/button";
import { CartaoDeEntrada } from "@/components/ui/cartao-de-entrada";
import { GoogleButton } from "@/components/ui/google-button";
import { db } from "@/db";
import { invites, players, users } from "@/db/schema";
import { mensagemDeErro } from "@/lib/erros-login";
import { sugerirUsername } from "@/lib/username";
import { ClaimForm } from "./claim-form";

export const metadata: Metadata = { title: "Convite" };

function ConviteInvalido() {
  return (
    <CartaoDeEntrada
      titulo="Convite inválido ou expirado"
      descricao="Ele pode ter vencido ou já ter sido usado. Fala com quem te convidou para gerar outro link."
    >
      <LinkButton href="/login" variante="secondary" className="w-full">
        Ir para o login
      </LinkButton>
    </CartaoDeEntrada>
  );
}

// Nada é consumido no GET — bots de preview do WhatsApp buscam a URL antes do
// convidado abrir. O convite só é marcado como usado dentro da Server Action.
export default async function ConvitePage({
  params,
  searchParams,
}: PageProps<"/convite/[token]">) {
  const { token } = await params;
  const { erro, esperado } = await searchParams;
  // Validade checada direto no banco (now() do Postgres) — regra de pureza do
  // React proíbe Date.now() durante o render.
  const [invite] = await db
    .select()
    .from(invites)
    .where(
      and(eq(invites.token, token), isNull(invites.usedAt), gt(invites.expiresAt, sql`now()`)),
    );
  if (!invite) return <ConviteInvalido />;

  const [player] = await db.select().from(players).where(eq(players.id, invite.playerId));
  if (!player || !player.active) return <ConviteInvalido />;
  const [user] = await db.select().from(users).where(eq(users.playerId, invite.playerId));
  const erroMensagem = mensagemDeErro(erro, esperado);

  const titulo = invite.email
    ? "Entrar com o Google"
    : user
      ? "Redefinir senha"
      : "Criar sua conta";

  const descricao = (
    <>
      Convite para <strong className="text-fg">{player.name}</strong>
      {player.nickname ? ` (“${player.nickname}”)` : ""}.
    </>
  );

  // Convite com e-mail é convite de Google, e só aquela conta o resgata — o
  // formulário de senha nem aparece, e a action recusaria de todo jeito.
  if (invite.email) {
    return (
      <CartaoDeEntrada titulo={titulo} descricao={descricao}>
        <div className="flex flex-col gap-3">
          {erroMensagem && <Banner tom="erro">{erroMensagem}</Banner>}
          <GoogleButton href={`/api/auth/google?convite=${encodeURIComponent(invite.token)}`} />
          <p className="text-[12px] leading-[1.45] text-fg-4">
            Use a conta <strong className="text-fg-2">{invite.email}</strong>. Entrar com outra não
            vai funcionar — se o endereço estiver errado, fala com quem te convidou.
          </p>
        </div>
      </CartaoDeEntrada>
    );
  }

  return (
    <CartaoDeEntrada titulo={titulo} descricao={descricao}>
      <div className="flex flex-col gap-3">
        {erroMensagem && <Banner tom="erro">{erroMensagem}</Banner>}
        <ClaimForm
          token={invite.token}
          existingUsername={user?.username ?? null}
          suggestedUsername={sugerirUsername(player.name, player.nickname)}
        />
      </div>
    </CartaoDeEntrada>
  );
}
