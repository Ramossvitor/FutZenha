import type { Metadata } from "next";
import Link from "next/link";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { groupInviteLinks, groups } from "@/db/schema";
import { condicaoLinkVivo } from "@/lib/grupos-link";
import { papelNoGrupo } from "@/lib/grupos";
import { getSession } from "@/lib/session";
import { resgatarLinkDoGrupo } from "./actions";

export const metadata: Metadata = { title: "Convite de grupo" };
export const dynamic = "force-dynamic";

const cardClass =
  "mx-auto mt-16 w-full max-w-sm rounded-xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900";

function LinkInvalido() {
  return (
    <div className={cardClass}>
      <h1 className="mb-2 text-xl font-bold">Convite inválido ou expirado</h1>
      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        Fala com quem administra o grupo para gerar outro link.
      </p>
    </div>
  );
}

// Nada é consumido no GET — bots de preview do WhatsApp buscam a URL antes do
// convidado abrir, e um link com teto de usos seria gasto pelo próprio preview.
// A entrada no grupo só acontece dentro da Server Action.
export default async function ConviteGrupoPage({ params }: PageProps<"/convite-grupo/[token]">) {
  const { token } = await params;

  // Validade pelo now() do Postgres: a regra de pureza do React proíbe
  // Date.now() durante o render.
  const [linha] = await db
    .select({ grupo: groups, link: groupInviteLinks })
    .from(groupInviteLinks)
    .innerJoin(groups, eq(groupInviteLinks.groupId, groups.id))
    .where(and(eq(groupInviteLinks.token, token), condicaoLinkVivo(sql`now()`)));
  if (!linha) return <LinkInvalido />;

  const { grupo } = linha;
  const session = await getSession();

  // Sem sessão o proxy já teria mandado para o login com ?next=; esta é a rede
  // de segurança caso o matcher mude.
  if (!session) {
    return (
      <div className={cardClass}>
        <h1 className="mb-2 text-xl font-bold">Convite para {grupo.name}</h1>
        <p className="mb-4 text-sm text-neutral-600 dark:text-neutral-400">
          Entre na sua conta para aceitar. Este link adiciona você ao grupo — ele não cria conta.
        </p>
        <Link
          href={`/login?next=${encodeURIComponent(`/convite-grupo/${token}`)}`}
          className="inline-block rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800"
        >
          Entrar
        </Link>
      </div>
    );
  }

  const papel = await papelNoGrupo(grupo.id, session.player.id);
  if (papel !== null) {
    return (
      <div className={cardClass}>
        <h1 className="mb-2 text-xl font-bold">Você já está em {grupo.name}</h1>
        <Link
          href={`/grupo/${grupo.id}`}
          className="mt-2 inline-block rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800"
        >
          Ver o grupo
        </Link>
      </div>
    );
  }

  return (
    <div className={cardClass}>
      <h1 className="mb-2 text-xl font-bold">Convite para {grupo.name}</h1>
      {grupo.description && (
        <p className="mb-4 text-sm text-neutral-600 dark:text-neutral-400">{grupo.description}</p>
      )}
      <p className="mb-4 text-sm text-neutral-600 dark:text-neutral-400">
        Você entra como membro: confirma presença nas peladas do grupo e participa dos rankings
        dele.
      </p>
      <form action={resgatarLinkDoGrupo.bind(null, token)}>
        <button
          type="submit"
          className="w-full rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800"
        >
          Entrar no grupo
        </button>
      </form>
    </div>
  );
}
