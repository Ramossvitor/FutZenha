import type { Metadata } from "next";
import { and, eq, sql } from "drizzle-orm";
import { LinkButton, SubmitButton } from "@/components/ui/button";
import { CartaoDeEntrada } from "@/components/ui/cartao-de-entrada";
import { db } from "@/db";
import { matchDayInviteLinks, matchDays } from "@/db/schema";
import { resgatarLinkDoFut } from "@/app/fut/[id]/entrada-actions";
import { condicaoLinkVivoDoFut, estaNaLista } from "@/lib/fut-entrada-db";
import { futAceitaEntrada } from "@/lib/fut-entrada";
import { formatDate, formatHorario } from "@/lib/format";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Convite de fut" };
export const dynamic = "force-dynamic";

// Espelho de /convite-grupo/[token], inclusive na decisão que mais importa:
// **nada é consumido no GET**. Bots de preview do WhatsApp buscam a URL antes
// de a pessoa abrir, e um link com teto de usos seria gasto pelo próprio
// preview. A entrada só acontece dentro da Server Action.
export default async function ConviteFutPage({ params }: PageProps<"/convite-fut/[token]">) {
  const { token } = await params;

  // Validade pelo now() do Postgres: a regra de pureza do render proíbe
  // Date.now() aqui.
  const [linha] = await db
    .select({ fut: matchDays, link: matchDayInviteLinks })
    .from(matchDayInviteLinks)
    .innerJoin(matchDays, eq(matchDayInviteLinks.matchDayId, matchDays.id))
    .where(and(eq(matchDayInviteLinks.token, token), condicaoLinkVivoDoFut(sql`now()`)));

  if (!linha) {
    return (
      <CartaoDeEntrada
        titulo="Convite inválido ou expirado"
        descricao="Ele pode ter vencido, sido revogado ou já ter batido o limite de usos. Fala com quem organiza o fut para gerar outro."
      >
        <LinkButton href="/futs" variante="secondary" className="w-full">
          Ver os futs
        </LinkButton>
      </CartaoDeEntrada>
    );
  }

  const { fut } = linha;
  const quando = `${formatDate(fut.date)}${
    formatHorario(fut.startTime, fut.endTime) ? `, ${formatHorario(fut.startTime, fut.endTime)}` : ""
  }`;

  // O estado do fut é conferido aqui E na action: o link vive sete dias e o
  // sorteio acontece no meio deles. Esta tela evita o botão que só erraria; a
  // action é quem garante.
  if (!futAceitaEntrada(fut)) {
    return (
      <CartaoDeEntrada
        titulo="Este fut já fechou a lista"
        descricao={`Os times do fut de ${quando} já foram sorteados, então não dá mais para entrar por aqui.`}
      >
        <LinkButton href={`/fut/${fut.id}`} className="w-full">
          Ver o fut
        </LinkButton>
      </CartaoDeEntrada>
    );
  }

  const session = await getSession();

  // Sem sessão o proxy já teria mandado para o login com ?next=; esta é a rede
  // de segurança caso o matcher mude.
  if (!session) {
    return (
      <CartaoDeEntrada
        titulo={`Fut de ${quando}`}
        descricao="Entre na sua conta para confirmar presença. Este link põe você na lista — ele não cria conta."
      >
        <LinkButton
          href={`/login?next=${encodeURIComponent(`/convite-fut/${token}`)}`}
          className="w-full"
        >
          Entrar
        </LinkButton>
      </CartaoDeEntrada>
    );
  }

  if (await estaNaLista(fut.id, session.player.id)) {
    return (
      <CartaoDeEntrada
        titulo="Você já está neste fut"
        descricao="Não precisa fazer nada — você entrou por este link ou por outro caminho."
      >
        <LinkButton href={`/fut/${fut.id}`} className="w-full">
          Ver o fut
        </LinkButton>
      </CartaoDeEntrada>
    );
  }

  return (
    <CartaoDeEntrada
      titulo={`Fut de ${quando}`}
      descricao={
        <>
          <p className="mb-2">Em {fut.location}.</p>
          <p>
            Confirmando aqui você entra na lista — ou na espera, se o fut já estiver cheio.
          </p>
        </>
      }
    >
      <form action={resgatarLinkDoFut.bind(null, token)}>
        <SubmitButton tamanho="lg" className="w-full">
          Confirmar presença
        </SubmitButton>
      </form>
    </CartaoDeEntrada>
  );
}
