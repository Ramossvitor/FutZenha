import type { Metadata } from "next";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { invites, players, users } from "@/db/schema";
import { ClaimForm } from "./claim-form";

export const metadata: Metadata = { title: "Convite" };

const cardClass =
  "mx-auto mt-16 w-full max-w-sm rounded-xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900";

// Sugestão de username a partir do apelido (ou primeiro nome): minúsculas,
// sem acento, só [a-z0-9._-].
function suggestUsername(name: string, nickname: string | null): string {
  return (nickname ?? name.split(" ")[0] ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9._-]/g, "")
    .slice(0, 20);
}

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
export default async function ConvitePage({ params }: PageProps<"/convite/[token]">) {
  const { token } = await params;
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

  return (
    <div className={cardClass}>
      <h1 className="mb-2 text-xl font-bold">{user ? "Redefinir senha" : "Criar sua conta"}</h1>
      <p className="mb-4 text-sm text-neutral-600 dark:text-neutral-400">
        Convite para <strong>{player.name}</strong>
        {player.nickname ? ` (“${player.nickname}”)` : ""}.
      </p>
      <ClaimForm
        token={invite.token}
        existingUsername={user?.username ?? null}
        suggestedUsername={suggestUsername(player.name, player.nickname)}
      />
    </div>
  );
}
