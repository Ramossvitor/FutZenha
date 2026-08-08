import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { BannerDaQuery } from "@/components/ui/banner";
import { LinkButton } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/card";
import { formatDate } from "@/lib/format";
import { STATUS_PELADA } from "@/lib/match-day-form";
import { requirePeladaAdmin } from "@/lib/require-pelada-admin";
import { carregarPainel } from "./dados";
import {
  SecaoDados,
  SecaoEncerrar,
  SecaoJogos,
  SecaoPresenca,
  SecaoTimes,
  ZonaDePerigo,
} from "./secoes";

// Mensagens que só fazem sentido nesta tela — as genéricas vêm do dicionário
// global.
const LOCAIS = {
  "dados-invalidos": "Dados inválidos — confira os campos.",
  "nome-duplicado": "Já existe um jogador com esse nome — use a busca acima.",
  "precisa-confirmar":
    "Esse jogador tem conta e ainda não entrou nesta pelada — ele mesmo marca Vou pela página da pelada. Você marca por quem ainda não tem acesso.",
  "motivo-curto": "Explique em pelo menos 10 caracteres por que a pelada deve ser apagada.",
};

export default async function GerenciarPeladaPage({
  params,
  searchParams,
}: PageProps<"/pelada/[id]/gerenciar">) {
  const { id: idParam } = await params;
  const { erro, ok } = await searchParams;
  const id = Number(idParam);
  if (!Number.isInteger(id)) notFound();
  // 404 para quem não administra esta pelada — inclusive para id inexistente.
  await requirePeladaAdmin(id);

  const pelada = await carregarPainel(id);

  return (
    <div className="flex flex-col gap-7">
      <PageHeader
        titulo={formatDate(pelada.matchDay.date)}
        selos={<Badge tom="outline">{STATUS_PELADA[pelada.matchDay.status]}</Badge>}
        descricao="Você organiza esta pelada."
        acao={
          <LinkButton href={`/pelada/${pelada.matchDay.id}`} variante="secondary" tamanho="sm">
            Ver página pública
          </LinkButton>
        }
      />

      <BannerDaQuery erro={erro} ok={ok} locais={LOCAIS} />

      <SecaoDados pelada={pelada} />
      <SecaoPresenca pelada={pelada} />
      <SecaoTimes pelada={pelada} />
      <SecaoJogos pelada={pelada} />
      <SecaoEncerrar pelada={pelada} />
      <ZonaDePerigo pelada={pelada} />
    </div>
  );
}
