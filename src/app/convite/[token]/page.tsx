import type { Metadata } from "next";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { invites, players, users } from "@/db/schema";
import { mensagemDeErro } from "@/lib/erros-login";
import { sugerirUsername } from "@/lib/username";
import { GoogleButton } from "../../google-button";
import { ClaimForm } from "./claim-form";

export const metadata: Metadata = { title: "Convite" };

const cardClass =
  "mx-auto mt-16 w-full max-w-sm rounded-xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900";

function InvalidInvite() {
  return (
    <div className={cardClass}>
      <h1 className="mb-2 text-xl font-bold">Convite inválido ou expirado</h1>
      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        Fala com quem te convidou para gerar outro link.
      </p>
    </div>
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
    .where(and(eq(invites.token, token), isNull(invites.usedAt), gt(invites.expiresAt, sql`now()`)));
  if (!invite) {
    return <InvalidInvite />;
  }

  const [player] = await db.select().from(players).where(eq(players.id, invite.playerId));
  if (!player || !player.active) return <InvalidInvite />;
  const [user] = await db.select().from(users).where(eq(users.playerId, invite.playerId));
  const erroMensagem = mensagemDeErro(erro, esperado);

  const cabecalho = (
    <>
      <h1 className="mb-2 text-xl font-bold">
        {invite.email ? "Entrar com o Google" : user ? "Redefinir senha" : "Criar sua conta"}
      </h1>
      <p className="mb-4 text-sm text-neutral-600 dark:text-neutral-400">
        Convite para <strong>{player.name}</strong>
        {player.nickname ? ` (“${player.nickname}”)` : ""}.
      </p>
      {erroMensagem && (
        <p className="mb-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {erroMensagem}
        </p>
      )}
    </>
  );

  // Convite com e-mail é convite de Google, e só aquela conta o resgata — o
  // formulário de senha nem aparece, e a action recusaria de todo jeito.
  if (invite.email) {
    return (
      <div className={cardClass}>
        {cabecalho}
        <GoogleButton href={`/api/auth/google?convite=${encodeURIComponent(invite.token)}`} />
        <p className="mt-4 text-xs text-neutral-500">
          Use a conta <strong>{invite.email}</strong>. Entrar com outra não vai funcionar — se o
          endereço estiver errado, fala com quem te convidou.
        </p>
      </div>
    );
  }

  return (
    <div className={cardClass}>
      {cabecalho}
      <ClaimForm
        token={invite.token}
        existingUsername={user?.username ?? null}
        suggestedUsername={sugerirUsername(player.name, player.nickname)}
      />
    </div>
  );
}
