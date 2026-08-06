import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
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
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-bold">Excluir uma pelada?</h1>
        <p className="text-sm text-neutral-500">
          <span className="capitalize">{formatDate(votacao.matchDayDate)}</span> · {votacao.location}
        </p>
      </header>

      <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="mb-1 text-sm font-medium text-neutral-500">Motivo de quem propôs</h2>
        <p>“{votacao.reason}”</p>
      </section>

      <p className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
        Se aprovada, a pelada é apagada <strong>para sempre</strong>: gols, vitórias, presenças e
        avaliações daquele dia somem, e a nota de todo mundo é recalculada sem eles. Seu voto é{" "}
        <strong>definitivo</strong> e não votar conta como <strong>contra</strong>.
      </p>

      <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-2xl font-bold">
            {votacao.placar.sim} <span className="text-sm font-normal text-neutral-500">a favor</span>
          </span>
          <span className="text-2xl font-bold">
            {votacao.placar.nao} <span className="text-sm font-normal text-neutral-500">contra</span>
          </span>
          <span className="ml-auto text-sm text-neutral-500">
            precisa de {votacao.placar.necessarios} de {votacao.placar.elegiveis}
          </span>
        </div>
        {votacao.status === "open" && (
          <p className="mt-2 text-sm text-neutral-500">
            Faltam {votacao.placar.faltam} voto(s) a favor · {votacao.horasRestantes}h de prazo ·{" "}
            {votacao.placar.pendentes} ainda não votaram
          </p>
        )}
      </section>

      {encerrada ? (
        <p className="rounded-lg border border-neutral-300 bg-neutral-100 px-4 py-3 text-sm dark:border-neutral-700 dark:bg-neutral-900">
          {votacao.status === "approved"
            ? "Votação aprovada — a pelada foi apagada."
            : "Votação rejeitada — a pelada continua no histórico."}
        </p>
      ) : votacao.jaVotei ? (
        <p className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
          Você votou <strong>{votacao.meuVoto ? "a favor de apagar" : "por manter"}</strong>. O voto
          é definitivo.
        </p>
      ) : (
        <VotarForm voteId={voteId} />
      )}

      <Link href="/avaliar" className="text-sm text-emerald-700 hover:underline dark:text-emerald-400">
        ← Voltar
      </Link>
    </div>
  );
}
