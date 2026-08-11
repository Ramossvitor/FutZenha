import type { Metadata } from "next";
import { and, eq, sql } from "drizzle-orm";
import { LinkButton, SubmitButton } from "@/components/ui/button";
import { CartaoDeEntrada } from "@/components/ui/cartao-de-entrada";
import { db } from "@/db";
import { groupInviteLinks, groups } from "@/db/schema";
import { condicaoLinkVivo } from "@/lib/grupos-link";
import { papelNoGrupo } from "@/lib/grupos";
import { getSession } from "@/lib/session";
import { resgatarLinkDoGrupo } from "./actions";

export const metadata: Metadata = { title: "Convite de grupo" };
export const dynamic = "force-dynamic";

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

  if (!linha) {
    return (
      <CartaoDeEntrada
        titulo="Convite inválido ou expirado"
        descricao="Ele pode ter vencido, sido revogado ou já ter batido o limite de usos. Fala com quem administra o grupo para gerar outro."
      >
        <LinkButton href="/" variante="secondary" className="w-full">
          Ir para o início
        </LinkButton>
      </CartaoDeEntrada>
    );
  }

  const { grupo } = linha;
  const session = await getSession();

  // Sem sessão o proxy já teria mandado para o login com ?next=; esta é a rede
  // de segurança caso o matcher mude.
  if (!session) {
    return (
      <CartaoDeEntrada
        titulo={`Convite para ${grupo.name}`}
        descricao="Entre na sua conta para aceitar. Este link adiciona você ao grupo — ele não cria conta."
      >
        <LinkButton
          href={`/login?next=${encodeURIComponent(`/convite-grupo/${token}`)}`}
          className="w-full"
        >
          Entrar
        </LinkButton>
      </CartaoDeEntrada>
    );
  }

  const papel = await papelNoGrupo(grupo.id, session.player.id);
  if (papel !== null) {
    return (
      <CartaoDeEntrada
        titulo={`Você já está em ${grupo.name}`}
        descricao="Não precisa fazer nada — o convite já foi usado ou você entrou por outro caminho."
      >
        <LinkButton href={`/grupo/${grupo.id}`} className="w-full">
          Ver o grupo
        </LinkButton>
      </CartaoDeEntrada>
    );
  }

  return (
    <CartaoDeEntrada
      titulo={`Convite para ${grupo.name}`}
      descricao={
        <>
          {grupo.description && <p className="mb-2">{grupo.description}</p>}
          <p>
            Você entra como membro: confirma presença nos futs do grupo e participa dos rankings
            dele.
          </p>
        </>
      }
    >
      <form action={resgatarLinkDoGrupo.bind(null, token)}>
        <SubmitButton tamanho="lg" className="w-full">
          Entrar no grupo
        </SubmitButton>
      </form>
    </CartaoDeEntrada>
  );
}
