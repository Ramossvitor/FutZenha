import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { LinkButton } from "@/components/ui/button";
import { Card, CardBody, Eyebrow, PageHeader } from "@/components/ui/card";
import { IconeAlerta } from "@/components/ui/icons";
import { BarraDaVotacao } from "@/components/ui/meter";
import { Prazo } from "@/components/ui/prazo";
import { getVotacao } from "@/lib/deletion";
import { formatDate } from "@/lib/format";
import { requirePlayer } from "@/lib/require-player";
import { VotarForm } from "./votar-form";

export const metadata: Metadata = { title: "Votação" };

export default async function VotacaoPage({ params }: PageProps<"/votacao/[id]">) {
  const { id: idParam } = await params;
  const session = await requirePlayer();
  const voteId = Number(idParam);
  if (!Number.isInteger(voteId)) notFound();

  // Só eleitor enxerga a votação — getVotacao já filtra por playerId.
  const votacao = await getVotacao(voteId, session.player.id);
  if (!votacao) notFound();

  const encerrada = votacao.status !== "open";

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        titulo="Apagar esta pelada?"
        selos={
          encerrada ? (
            <Badge tom={votacao.status === "approved" ? "danger" : "neutral"}>
              {votacao.status === "approved" ? "aprovada" : "rejeitada"}
            </Badge>
          ) : (
            <Prazo horas={votacao.horasRestantes} />
          )
        }
        descricao={
          <>
            <span className="capitalize">{formatDate(votacao.matchDayDate)}</span> ·{" "}
            {votacao.location}
          </>
        }
      />

      <Card>
        <CardBody className="flex flex-col gap-1">
          <Eyebrow>motivo de quem propôs</Eyebrow>
          <p className="text-[14px] leading-[1.5] text-fg">“{votacao.reason}”</p>
        </CardBody>
      </Card>

      <Card className="border-danger-line bg-danger-tint">
        <CardBody className="flex items-start gap-2.5">
          <IconeAlerta className="mt-0.5 size-5 shrink-0 text-danger" />
          <p className="text-[13px] leading-[1.5] text-fg-2">
            Se aprovada, a pelada é apagada <strong className="text-fg">para sempre</strong>: gols,
            vitórias, presenças e avaliações daquele dia somem, e a nota de todo mundo é
            recalculada sem eles. Seu voto é <strong className="text-fg">definitivo</strong>, e não
            votar conta como <strong className="text-fg">contra</strong>.
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="flex flex-col gap-2.5">
          <div className="flex items-end gap-4">
            <span>
              <Eyebrow>a favor</Eyebrow>
              <span
                className="block font-display text-[30px] leading-none font-black font-stretch-125% text-accent-ink"
                data-num
              >
                {votacao.placar.sim}
              </span>
            </span>
            <span>
              <Eyebrow>contra</Eyebrow>
              <span
                className="block font-display text-[30px] leading-none font-black font-stretch-125% text-danger-ink"
                data-num
              >
                {votacao.placar.nao}
              </span>
            </span>
            <span className="ml-auto text-right">
              <Eyebrow>precisa de</Eyebrow>
              <span className="block font-display text-[14px] font-bold text-fg-2" data-num>
                {votacao.placar.necessarios} de {votacao.placar.elegiveis}
              </span>
            </span>
          </div>

          <BarraDaVotacao
            sim={votacao.placar.sim}
            nao={votacao.placar.nao}
            elegiveis={votacao.placar.elegiveis}
          />

          {votacao.status === "open" && (
            <p className="text-[12.5px] text-fg-4">
              Faltam {votacao.placar.faltam}{" "}
              {votacao.placar.faltam === 1 ? "voto a favor" : "votos a favor"} ·{" "}
              {votacao.placar.pendentes} ainda não votaram — e o silêncio conta contra.
            </p>
          )}
        </CardBody>
      </Card>

      {encerrada ? (
        <Banner tom="info">
          {votacao.status === "approved"
            ? "Votação aprovada — a pelada foi apagada."
            : "Votação rejeitada — a pelada continua no histórico."}
        </Banner>
      ) : votacao.jaVotei ? (
        <Banner tom="ok">
          Você votou <strong>{votacao.meuVoto ? "a favor de apagar" : "por manter"}</strong>. O voto
          é definitivo.
        </Banner>
      ) : (
        <VotarForm voteId={voteId} />
      )}

      <LinkButton href="/avaliar" variante="ghost" tamanho="sm" className="self-start">
        ← Voltar
      </LinkButton>
    </div>
  );
}
