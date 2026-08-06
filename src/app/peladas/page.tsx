import Link from "next/link";
import { desc, asc, inArray } from "drizzle-orm";
import { db } from "@/db";
import { games, matchDays, teams } from "@/db/schema";
import { formatDate, formatDateShort, formatTime } from "@/lib/format";
import { podeGerenciarPelada } from "@/lib/permissions";
import { getSession } from "@/lib/session";

export const metadata = { title: "Peladas" };
export const dynamic = "force-dynamic";

const okMessages: Record<string, string> = {
  "excluida-sem-votacao":
    "Pelada apagada direto: ninguém com conta jogou, então não havia quem votasse. As notas foram recalculadas.",
};

export default async function PeladasPage({ searchParams }: PageProps<"/peladas">) {
  const { ok } = await searchParams;
  const mensagemOk = typeof ok === "string" ? okMessages[ok] : undefined;
  const session = await getSession();
  const ator = session
    ? { playerId: session.player.id, isPlatformAdmin: session.isPlatformAdmin }
    : null;
  const days = await db.select().from(matchDays).orderBy(desc(matchDays.date), desc(matchDays.id));
  const dayIds = days.map((d) => d.id);
  const gameRows = dayIds.length
    ? await db
        .select()
        .from(games)
        .where(inArray(games.matchDayId, dayIds))
        .orderBy(asc(games.sortOrder), asc(games.id))
    : [];
  const teamRows = dayIds.length
    ? await db.select().from(teams).where(inArray(teams.matchDayId, dayIds))
    : [];
  const teamNameById = new Map(teamRows.map((t) => [t.id, t.name]));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Peladas</h1>
        {session && (
          <Link
            href="/peladas/nova"
            className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800"
          >
            Marcar pelada
          </Link>
        )}
      </div>

      {mensagemOk && (
        <p className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
          {mensagemOk}
        </p>
      )}

      {days.length === 0 && <p className="text-neutral-500">Nenhuma pelada marcada ainda.</p>}
      <div className="flex flex-col gap-2">
        {days.map((day) => {
          const dayGames = gameRows.filter((g) => g.matchDayId === day.id);
          const euGerencio = ator !== null && podeGerenciarPelada(ator, day);
          return (
            <Link
              key={day.id}
              href={`/pelada/${day.id}`}
              className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm hover:border-emerald-600 dark:border-neutral-800 dark:bg-neutral-900"
            >
              <div className="flex items-center gap-2">
                <span className="font-bold capitalize">{formatDate(day.date)}</span>
                <span className="text-sm text-neutral-500">{formatDateShort(day.date)}</span>
                {euGerencio && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900 dark:text-amber-200">
                    você gerencia
                  </span>
                )}
                {day.status !== "finished" && (
                  <span className="ml-auto rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
                    {day.status === "scheduled" ? "marcada" : "times sorteados"}
                  </span>
                )}
              </div>
              <p className="text-sm text-neutral-500">
                {formatTime(day.startTime) && <>{formatTime(day.startTime)} · </>}
                {day.location}
              </p>
              {dayGames.length > 0 && (
                <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
                  {dayGames
                    .map(
                      (g) =>
                        `${teamNameById.get(g.teamAId)} ${g.scoreA}×${g.scoreB} ${teamNameById.get(g.teamBId)}`,
                    )
                    .join(" · ")}
                </p>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
