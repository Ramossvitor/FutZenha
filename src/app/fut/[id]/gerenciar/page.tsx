import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { BannerDaQuery } from "@/components/ui/banner";
import { LinkButton } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/card";
import { formatDate } from "@/lib/format";
import { STATUS_FUT } from "@/lib/match-day-form";
import { requireFutAdmin } from "@/lib/require-fut-admin";
import { sumulaDisponivel } from "@/lib/sumula";
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
    "Esse jogador tem conta e ainda não entrou neste fut — ele mesmo marca Vou pela página do fut. Você marca por quem ainda não tem acesso.",
  "motivo-curto": "Explique em pelo menos 10 caracteres por que o fut deve ser apagado.",
};

export default async function GerenciarFutPage({
  params,
  searchParams,
}: PageProps<"/fut/[id]/gerenciar">) {
  const { id: idParam } = await params;
  const { erro, ok } = await searchParams;
  const id = Number(idParam);
  if (!Number.isInteger(id)) notFound();
  // 404 para quem não administra este fut — inclusive para id inexistente.
  await requireFutAdmin(id);

  const fut = await carregarPainel(id);

  return (
    <div className="flex flex-col gap-7">
      <PageHeader
        titulo={formatDate(fut.matchDay.date)}
        selos={<Badge tom="outline">{STATUS_FUT[fut.matchDay.status]}</Badge>}
        descricao="Você organiza este fut."
        acao={
          <span className="flex flex-wrap gap-1.5">
            {/* A súmula só faz sentido com times sorteados — antes não há
                lado para creditar gol. Mesma regra da página do painel e do
                iniciarJogo (src/lib/sumula.ts). */}
            {sumulaDisponivel(fut.matchDay) && (
              <LinkButton href={`/fut/${fut.matchDay.id}/sumula`} tamanho="sm">
                Súmula ao vivo
              </LinkButton>
            )}
            <LinkButton href={`/fut/${fut.matchDay.id}`} variante="secondary" tamanho="sm">
              Ver página pública
            </LinkButton>
          </span>
        }
      />

      <BannerDaQuery erro={erro} ok={ok} locais={LOCAIS} />

      <SecaoDados fut={fut} />
      <SecaoPresenca fut={fut} />
      <SecaoTimes fut={fut} />
      <SecaoJogos fut={fut} />
      <SecaoEncerrar fut={fut} />
      <ZonaDePerigo fut={fut} />
    </div>
  );
}
