import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { LinkButton } from "@/components/ui/button";
import { Card, PageHeader, Section } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Estrelas } from "@/components/ui/estrelas";
import { HairlineList, HairlineRow } from "@/components/ui/hairline-list";
import { IconeCadeado } from "@/components/ui/icons";
import { Prazo } from "@/components/ui/prazo";
import { db } from "@/db";
import { matchDays, ratingRoundRaters, ratingRounds } from "@/db/schema";
import { formatDate } from "@/lib/format";
import { getCompanheiros, getMinhasAvaliacoes, getPendenciasDaRodada } from "@/lib/ratings";
import { requirePlayer } from "@/lib/require-player";
import { RatingForm, type CompanheiroForm } from "./rating-form";

export const metadata: Metadata = { title: "Avaliar companheiros" };

export default async function AvaliarRodadaPage({ params }: PageProps<"/avaliar/[id]">) {
  const { id: idParam } = await params;
  const session = await requirePlayer();
  const roundId = Number(idParam);
  if (!Number.isInteger(roundId)) notFound();

  // Só quem foi congelado como avaliador na abertura enxerga a rodada. O
  // prazo vem do Postgres para não usar Date.now() no render.
  const [rodada] = await db
    .select({
      status: ratingRounds.status,
      matchDayId: ratingRounds.matchDayId,
      matchDayDate: matchDays.date,
      location: matchDays.location,
      submittedAt: ratingRoundRaters.submittedAt,
      venceu: sql<boolean>`${ratingRounds.deadlineAt} <= now()`,
      horasRestantes: sql<number>`greatest(0, ceil(extract(epoch from (
        ${ratingRounds.deadlineAt} - now()
      )) / 3600)::int)`,
    })
    .from(ratingRoundRaters)
    .innerJoin(ratingRounds, eq(ratingRoundRaters.roundId, ratingRounds.id))
    .innerJoin(matchDays, eq(ratingRounds.matchDayId, matchDays.id))
    .where(
      and(
        eq(ratingRoundRaters.roundId, roundId),
        eq(ratingRoundRaters.playerId, session.player.id),
      ),
    );
  if (!rodada) notFound();

  const [companheiros, jaDadas, pendencias] = await Promise.all([
    getCompanheiros(rodada.matchDayId, session.player.id),
    getMinhasAvaliacoes(roundId, session.player.id),
    getPendenciasDaRodada(roundId),
  ]);

  const encerrada = rodada.status !== "open" || rodada.venceu;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        titulo={
          <>
            Como foi
            <br />a rapaziada?
          </>
        }
        selos={
          encerrada ? (
            <Badge tom="neutral">encerrada</Badge>
          ) : (
            <Prazo horas={rodada.horasRestantes} />
          )
        }
        descricao={
          <>
            <span className="capitalize">{formatDate(rodada.matchDayDate)}</span> ·{" "}
            {rodada.location}
            <span className="mt-0.5 block text-fg-4">Só quem dividiu lado com você.</span>
          </>
        }
      />

      {!encerrada && (
        <Card className="border-accent-line bg-accent-tint p-3.5">
          <div className="flex items-start gap-2.5">
            <IconeCadeado className="mt-0.5 size-5 shrink-0 text-accent-ink" />
            <div>
              <p className="font-display text-[14px] font-extrabold font-stretch-112% text-accent-ink">
                Ninguém vai saber que foi você.
              </p>
              <p className="mt-0.5 text-[12.5px] leading-[1.5] text-fg-2">
                A pessoa vê a estrela que recebeu, nunca quem deu. Nem quem organiza, nem quem
                administra. A apuração sai antes do prazo se todo mundo avaliar — ainda faltam{" "}
                {pendencias.pendentes} de {pendencias.total}.
              </p>
            </div>
          </div>
        </Card>
      )}

      {encerrada && (
        <Banner tom="info">
          O prazo desta avaliação já acabou.{" "}
          {rodada.submittedAt
            ? "A sua avaliação foi contabilizada."
            : "Você não avaliou a tempo, e as notas foram calculadas sem a sua."}
        </Banner>
      )}

      {companheiros.length === 0 ? (
        <EmptyState
          titulo="Ninguém para avaliar"
          descricao="Seus companheiros de time nesta pelada ainda não têm conta no sistema. A avaliação precisa de três contas ativas do mesmo lado."
        />
      ) : encerrada ? (
        <Section titulo="O que você deu">
          <HairlineList as="ul">
            {companheiros.map((c) => (
              <HairlineRow as="li" key={c.playerId}>
                <span className="min-w-0 flex-1 truncate font-display text-[14px] font-bold text-fg">
                  {c.nickname ?? c.name}
                </span>
                {jaDadas.has(c.playerId) ? (
                  <Estrelas valor={jaDadas.get(c.playerId)!} />
                ) : (
                  <span className="text-[12px] text-fg-4">não avaliou</span>
                )}
              </HairlineRow>
            ))}
          </HairlineList>
        </Section>
      ) : (
        <RatingForm
          roundId={roundId}
          jaEnviou={rodada.submittedAt !== null}
          companheiros={companheiros.map(
            (c): CompanheiroForm => ({
              playerId: c.playerId,
              rotulo: c.nickname ?? c.name,
              nome: c.name,
              isGoalkeeper: c.isGoalkeeper,
              estrelasAtuais: jaDadas.get(c.playerId),
            }),
          )}
        />
      )}

      <LinkButton href="/avaliar" variante="ghost" tamanho="sm" className="self-start">
        ← Todas as avaliações
      </LinkButton>
    </div>
  );
}
