import Link from "next/link";
import { asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { matchDays, ratingRoundRaters, ratingRounds, users } from "@/db/schema";
import { formatDate } from "@/lib/format";
import { getContextoDaDenuncia, getDenunciasAbertas } from "@/lib/reports";
import { requirePlatformAdmin } from "@/lib/require-platform-admin";
import { aceitarDenuncia, apurarAgora, rejeitarDenuncia } from "./actions";

export const metadata = { title: "Avaliações" };

const notaClass =
  "rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-emerald-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100";

export default async function AdminAvaliacoesPage() {
  const session = await requirePlatformAdmin();
  const [denuncias, rodadas] = await Promise.all([
    getDenunciasAbertas(session.player.id),
    db
      .select({
        id: ratingRounds.id,
        status: ratingRounds.status,
        matchDayId: ratingRounds.matchDayId,
        matchDayDate: matchDays.date,
        total: sql<number>`count(${ratingRoundRaters.playerId})::int`,
        pendentes: sql<number>`count(*) filter (
          where ${ratingRoundRaters.submittedAt} is null and ${users.active}
        )::int`,
        horasRestantes: sql<number>`greatest(0, ceil(extract(epoch from (
          ${ratingRounds.deadlineAt} - now()
        )) / 3600)::int)`,
      })
      .from(ratingRounds)
      .innerJoin(matchDays, eq(ratingRounds.matchDayId, matchDays.id))
      .leftJoin(ratingRoundRaters, eq(ratingRoundRaters.roundId, ratingRounds.id))
      .leftJoin(users, eq(ratingRoundRaters.userId, users.id))
      .groupBy(ratingRounds.id, matchDays.date, matchDays.id)
      .orderBy(asc(ratingRounds.status), desc(matchDays.date))
      .limit(20),
  ]);

  // O contexto de cada denúncia: todas as notas que a pessoa recebeu naquela
  // rodada, para o admin não decidir olhando só a nota reclamada.
  const contextos = await Promise.all(
    denuncias.map((d) =>
      getContextoDaDenuncia(d.roundId, d.reporterPlayerId, d.ratingId, session.player.id),
    ),
  );

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Avaliações</h1>

      <section className="flex flex-col gap-3">
        <h2 className="font-bold">
          Denúncias abertas{" "}
          <span className="text-sm font-normal text-neutral-500">({denuncias.length})</span>
        </h2>

        {denuncias.length === 0 ? (
          <p className="rounded-xl border border-neutral-200 bg-white p-4 text-sm text-neutral-500 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
            Nada para julgar agora.
          </p>
        ) : (
          denuncias.map((d, i) => {
            const contexto = contextos[i];
            return (
              <div
                key={d.reportId}
                className="rounded-xl border border-amber-300 bg-white p-4 shadow-sm dark:border-amber-800 dark:bg-neutral-900"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{d.reporterName}</span>
                  <span className="text-sm text-neutral-500 capitalize">
                    {formatDate(d.matchDayDate)}
                  </span>
                  <span
                    className={`ml-auto rounded-full px-2 py-0.5 text-xs font-medium ${
                      d.horasParaResponder <= 12
                        ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300"
                        : "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200"
                    }`}
                  >
                    {d.horasParaResponder}h para responder
                  </span>
                </div>

                <p className="mt-2 text-sm">
                  Contesta a nota de{" "}
                  <strong className="text-amber-600 dark:text-amber-400">
                    {"★".repeat(d.starsDenunciada)}
                  </strong>{" "}
                  ({d.starsDenunciada} de 5)
                  {d.raterName && (
                    <>
                      , dada por <strong>{d.raterName}</strong>
                    </>
                  )}
                </p>

                <p className="mt-1 text-sm text-neutral-500">
                  Todas as notas que recebeu nessa pelada:{" "}
                  {contexto.map((c, j) => (
                    <span
                      key={j}
                      className={
                        c.reclamada
                          ? "font-bold text-amber-600 dark:text-amber-400"
                          : c.descartada
                            ? "text-neutral-400 line-through"
                            : ""
                      }
                    >
                      {j > 0 && " · "}
                      {c.stars}★{c.raterName && ` (${c.raterName})`}
                      {c.reclamada ? " — reclamada" : ""}
                    </span>
                  ))}
                </p>

                <p className="mt-1 text-xs text-neutral-500">
                  {d.podeJulgar
                    ? "Os nomes de quem avaliou aparecem só aqui: entre jogadores a nota continua anônima."
                    : "Você jogou esta pelada, então não julga esta denúncia e não vê quem avaliou. Outro admin da plataforma decide — ou o prazo vence e ela é aceita automaticamente."}
                </p>

                {d.reason && (
                  <p className="mt-2 rounded-lg bg-neutral-100 px-3 py-2 text-sm dark:bg-neutral-800">
                    “{d.reason}”
                  </p>
                )}

                {d.podeJulgar && (
                  <div className="mt-3 flex flex-col gap-2">
                    <input
                      form={`aceitar-${d.reportId}`}
                      name="adminNote"
                      placeholder="Observação (opcional, fica no registro)"
                      className={notaClass}
                    />
                    <div className="flex flex-wrap gap-2">
                      <form
                        id={`aceitar-${d.reportId}`}
                        action={aceitarDenuncia.bind(null, d.reportId)}
                      >
                        <button
                          type="submit"
                          className="rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800"
                        >
                          Descartar a nota
                        </button>
                      </form>
                      <form action={rejeitarDenuncia.bind(null, d.reportId)}>
                        <button
                          type="submit"
                          className="rounded-lg border border-neutral-300 px-4 py-2 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
                        >
                          Manter — foi justa
                        </button>
                      </form>
                    </div>
                    <p className="text-xs text-neutral-500">
                      Descartar recalcula a nota de todo mundo desta pelada em diante. Sem resposta
                      em {d.horasParaResponder}h, a denúncia é aceita automaticamente.
                    </p>
                  </div>
                )}
              </div>
            );
          })
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-bold">Rodadas</h2>
        {rodadas.length === 0 ? (
          <p className="rounded-xl border border-neutral-200 bg-white p-4 text-sm text-neutral-500 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
            Nenhuma rodada ainda. Encerrar uma pelada abre a primeira.
          </p>
        ) : (
          rodadas.map((r) => (
            <div
              key={r.id}
              className="flex flex-wrap items-center gap-2 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900"
            >
              <Link
                href={`/pelada/${r.matchDayId}/gerenciar`}
                className="font-medium capitalize hover:underline"
              >
                {formatDate(r.matchDayDate)}
              </Link>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  r.status === "open"
                    ? "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200"
                    : "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200"
                }`}
              >
                {r.status === "open" ? "aberta" : r.status === "closed" ? "apurada" : "cancelada"}
              </span>
              <span className="text-sm text-neutral-500">
                {r.total - r.pendentes} de {r.total} avaliaram
                {r.status === "open" && ` · ${r.horasRestantes}h restantes`}
              </span>
              {r.status === "open" && (
                <form action={apurarAgora.bind(null, r.id)} className="ml-auto">
                  <button
                    type="submit"
                    className="rounded-lg border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
                  >
                    Apurar agora
                  </button>
                </form>
              )}
            </div>
          ))
        )}
      </section>
    </div>
  );
}
