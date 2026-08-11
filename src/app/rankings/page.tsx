import { abaValida, anoValido, Rankings } from "@/components/rankings";
import { PageHeader } from "@/components/ui/card";
import { getGrupoAtual } from "@/lib/grupo-atual";
import { getSession } from "@/lib/session";

export const metadata = { title: "Rankings" };
export const dynamic = "force-dynamic";

export default async function RankingsPage({ searchParams }: PageProps<"/rankings">) {
  const { aba, ano } = await searchParams;
  const [session, grupo] = await Promise.all([getSession(), getGrupoAtual()]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        titulo="Rankings"
        descricao={
          grupo
            ? `Números deste grupo, só. Trocar de grupo troca os números.`
            : "Somando todos os futs, de todos os grupos."
        }
      />
      <Rankings
        base="/rankings"
        aba={abaValida(aba)}
        ano={anoValido(ano)}
        groupId={grupo?.id}
        destaquePlayerId={session?.player.id}
      />
    </div>
  );
}
