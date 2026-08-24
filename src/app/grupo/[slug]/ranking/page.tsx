import { abaValida, anoValido, Rankings } from "@/components/rankings";
import { LinkButton } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/card";
import { requireGrupoMembro } from "@/lib/require-grupo";

export const dynamic = "force-dynamic";
// metadata estático de propósito: um generateMetadata aqui rodaria ANTES do
// guard e teria de repetir a checagem de visibilidade para não vazar o nome do
// grupo privado no <title>.
export const metadata = { title: "Ranking do grupo" };

/**
 * O ranking de um grupo específico, por link direto.
 *
 * Usa o mesmo componente de /rankings, só que com o escopo vindo da URL em vez
 * do contexto — assim o link colado no zap sempre mostra o grupo certo, mesmo
 * para quem está navegando noutro.
 *
 * Quem aparece é quem JOGOU os futs do grupo, membro ou não: o convidado de
 * fora que fez três gols conta na artilharia daqui. A única exclusão é a de
 * sempre, quem não tem conta ativa.
 */
export default async function RankingDoGrupoPage({
  params,
  searchParams,
}: PageProps<"/grupo/[slug]/ranking">) {
  const { slug } = await params;
  // O guard recebe o slug da URL e devolve o grupo resolvido; daqui para baixo
  // o escopo dos rankings é `grupo.id`, que é o que as consultas falam.
  const { grupo, session } = await requireGrupoMembro(slug);
  const groupId = grupo.id;
  const { aba, ano } = await searchParams;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        titulo={grupo.name}
        selos={<span className="eyebrow">Ranking do grupo</span>}
        descricao="Só os futs deste grupo entram nesta conta."
        acao={
          <LinkButton href={`/grupo/${grupo.slug}`} variante="secondary" tamanho="sm">
            Ver o grupo
          </LinkButton>
        }
      />
      <Rankings
        base={`/grupo/${grupo.slug}/ranking`}
        aba={abaValida(aba, groupId)}
        ano={anoValido(ano)}
        groupId={groupId}
        destaquePlayerId={session.player.id}
      />
    </div>
  );
}
