import type { Metadata } from "next";
import Link from "next/link";
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
import { WhatsAppShareButton } from "@/components/ui/whatsapp-share-button";
import { db } from "@/db";
import { matchDays, ratingRoundRaters, ratingRounds } from "@/db/schema";
import { formatDate } from "@/lib/format";
import {
  getAvaliadoresDaRodada,
  getCandidatosMvp,
  getCompanheiros,
  getMinhasAvaliacoes,
} from "@/lib/ratings";
import { requirePlayer } from "@/lib/require-player";
import { siteUrl } from "@/lib/site-url";
import { textoDeCobrancaDeAvaliacao } from "@/lib/whatsapp";
import { RatingForm, type CandidatoMvpForm, type CompanheiroForm } from "./rating-form";

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
      mvpPlayerId: ratingRoundRaters.mvpPlayerId,
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

  const [companheiros, jaDadas, avaliadores, candidatos] = await Promise.all([
    getCompanheiros(rodada.matchDayId, session.player.id),
    getMinhasAvaliacoes(roundId, session.player.id),
    getAvaliadoresDaRodada(roundId),
    getCandidatosMvp(rodada.matchDayId, session.player.id),
  ]);

  const encerrada = rodada.status !== "open" || rodada.venceu;
  const faltam = avaliadores.filter((a) => !a.jaAvaliou);

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
                {faltam.length} de {avaliadores.length}.{" "}
                <Link href="/guia#a-avaliacao" className="text-accent-ink hover:underline">
                  Como a avaliação funciona
                </Link>
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
          descricao="Seus companheiros de time neste fut ainda não têm conta no sistema. A avaliação precisa de três contas ativas do mesmo lado."
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
                  <Estrelas meias={jaDadas.get(c.playerId)!} />
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
          candidatos={candidatos.map(
            (c): CandidatoMvpForm => ({
              playerId: c.playerId,
              rotulo: c.nickname ?? c.name,
              nome: c.name,
              isGoalkeeper: c.isGoalkeeper,
            }),
          )}
          mvpAtual={rodada.mvpPlayerId}
        />
      )}

      {/* Quem está devendo, com nome, para a rapaziada cobrar — e o link pronto
          para o grupo. Só com a rodada aberta: depois de apurada, cruzar "só o
          Zé avaliou" com a estrela que a pessoa recebeu entregaria quem deu. */}
      {!encerrada && (
        <Section
          titulo="Quem já avaliou"
          acao={
            <Badge tom="neutral">
              {avaliadores.length - faltam.length} de {avaliadores.length}
            </Badge>
          }
        >
          <HairlineList as="ul">
            {avaliadores.map((a) => (
              <HairlineRow as="li" key={a.playerId} destaque={a.playerId === session.player.id}>
                <span className="min-w-0 flex-1 truncate font-display text-[14px] font-bold text-fg">
                  {a.nickname ?? a.name}
                </span>
                {a.playerId === session.player.id && (
                  <Badge tom="outline" caixa="normal">
                    você
                  </Badge>
                )}
                <Badge tom={a.jaAvaliou ? "accent" : "warn"} ponto>
                  {a.jaAvaliou ? "já avaliou" : "não avaliou"}
                </Badge>
              </HairlineRow>
            ))}
          </HairlineList>
          <WhatsAppShareButton
            rotulo="Cobrar no WhatsApp"
            className="self-start"
            texto={textoDeCobrancaDeAvaliacao(
              {
                roundId,
                date: rodada.matchDayDate,
                location: rodada.location,
                horasRestantes: rodada.horasRestantes,
                total: avaliadores.length,
                faltam: faltam.map((a) => a.nickname ?? a.name),
              },
              siteUrl(),
            )}
          />
        </Section>
      )}

      <LinkButton href="/avaliar" variante="ghost" tamanho="sm" className="self-start">
        ← Todas as avaliações
      </LinkButton>
    </div>
  );
}
