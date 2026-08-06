import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
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
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-bold">Avaliar companheiros</h1>
        <p className="text-sm text-neutral-500">
          <span className="capitalize">{formatDate(rodada.matchDayDate)}</span> · {rodada.location}
        </p>
      </header>

      {encerrada ? (
        <p className="rounded-lg border border-neutral-300 bg-neutral-100 px-4 py-3 text-sm text-neutral-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
          O prazo desta avaliação já acabou.{" "}
          {rodada.submittedAt
            ? "A sua avaliação foi contabilizada."
            : "Você não avaliou a tempo, e as notas foram calculadas sem a sua."}
        </p>
      ) : (
        <p className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
          Dê de 1 a 5 estrelas para quem jogou do seu lado. As avaliações são{" "}
          <strong>anônimas</strong>. Faltam {rodada.horasRestantes}h para o prazo, e a apuração
          acontece antes se todos avaliarem — ainda faltam {pendencias.pendentes} de{" "}
          {pendencias.total}.
        </p>
      )}

      {companheiros.length === 0 ? (
        <p className="rounded-xl border border-neutral-200 bg-white p-4 text-sm text-neutral-500 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          Ninguém para avaliar nesta pelada — seus companheiros de time ainda não têm conta no
          sistema.
        </p>
      ) : encerrada ? (
        <ul className="flex flex-col gap-2">
          {companheiros.map((c) => (
            <li
              key={c.playerId}
              className="flex items-center gap-2 rounded-xl border border-neutral-200 bg-white p-3 text-sm shadow-sm dark:border-neutral-800 dark:bg-neutral-900"
            >
              <span>
                {c.isGoalkeeper ? "🧤 " : ""}
                {c.nickname ?? c.name}
              </span>
              <span className="ml-auto text-amber-400">
                {jaDadas.has(c.playerId) ? "★".repeat(jaDadas.get(c.playerId)!) : "—"}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <RatingForm
          roundId={roundId}
          jaEnviou={rodada.submittedAt !== null}
          companheiros={companheiros.map(
            (c): CompanheiroForm => ({
              playerId: c.playerId,
              rotulo: c.nickname ?? c.name,
              isGoalkeeper: c.isGoalkeeper,
              estrelasAtuais: jaDadas.get(c.playerId),
            }),
          )}
        />
      )}

      <Link href="/avaliar" className="text-sm text-emerald-700 hover:underline dark:text-emerald-400">
        ← Todas as avaliações
      </Link>
    </div>
  );
}
