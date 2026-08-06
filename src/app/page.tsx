import Link from "next/link";
import { and, asc, desc, eq, gte, inArray, ne } from "drizzle-orm";
import { getTopScorers } from "@/lib/stats";

export const dynamic = "force-dynamic";
import { db } from "@/db";
import { attendances, games, matchDays, teams } from "@/db/schema";
import { formatDate, formatTime, todayISO } from "@/lib/format";

export default async function HomePage() {
  const [nextMatch] = await db
    .select()
    .from(matchDays)
    .where(and(gte(matchDays.date, todayISO()), ne(matchDays.status, "finished")))
    .orderBy(asc(matchDays.date), asc(matchDays.id))
    .limit(1);

  const confirmedCount = nextMatch
    ? (
        await db
          .select()
          .from(attendances)
          .where(and(eq(attendances.matchDayId, nextMatch.id), eq(attendances.status, "in")))
      ).length
    : 0;

  const recentDays = await db
    .select()
    .from(matchDays)
    .where(eq(matchDays.status, "finished"))
    .orderBy(desc(matchDays.date), desc(matchDays.id))
    .limit(3);
  const recentGames = recentDays.length
    ? await db
        .select()
        .from(games)
        .where(
          inArray(
            games.matchDayId,
            recentDays.map((d) => d.id),
          ),
        )
        .orderBy(asc(games.sortOrder))
    : [];
  const teamRows = recentDays.length
    ? await db
        .select()
        .from(teams)
        .where(
          inArray(
            teams.matchDayId,
            recentDays.map((d) => d.id),
          ),
        )
    : [];
  const teamNameById = new Map(teamRows.map((t) => [t.id, t.name]));

  const topScorers = (await getTopScorers()).slice(0, 3);

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h1 className="mb-3 text-2xl font-bold">Próxima pelada</h1>
        {nextMatch ? (
          <Link
            href={`/pelada/${nextMatch.id}`}
            className="block rounded-xl border-2 border-emerald-600 bg-white p-5 shadow-sm hover:bg-emerald-50 dark:bg-neutral-900 dark:hover:bg-neutral-800"
          >
            <p className="text-xl font-bold capitalize">{formatDate(nextMatch.date)}</p>
            <p className="text-neutral-500">
              {formatTime(nextMatch.startTime) && <>{formatTime(nextMatch.startTime)} · </>}
              {nextMatch.location}
            </p>
            <p className="mt-2 text-sm font-medium text-emerald-700 dark:text-emerald-400">
              {confirmedCount} confirmado{confirmedCount === 1 ? "" : "s"} — toca aqui para
              confirmar presença →
            </p>
          </Link>
        ) : (
          <p className="rounded-xl border border-dashed border-neutral-300 p-5 text-neutral-500 dark:border-neutral-700">
            Nenhuma pelada marcada ainda. ⚽
          </p>
        )}
      </section>

      {recentDays.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-bold">Últimos resultados</h2>
          <div className="flex flex-col gap-2">
            {recentDays.map((day) => {
              const dayGames = recentGames.filter((g) => g.matchDayId === day.id);
              return (
                <Link
                  key={day.id}
                  href={`/pelada/${day.id}`}
                  className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm hover:border-emerald-600 dark:border-neutral-800 dark:bg-neutral-900"
                >
                  <p className="font-medium capitalize">{formatDate(day.date)}</p>
                  {dayGames.length > 0 && (
                    <p className="text-sm text-neutral-500">
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
          <Link
            href="/peladas"
            className="mt-2 inline-block text-sm font-medium text-emerald-700 hover:underline dark:text-emerald-400"
          >
            Ver todas as peladas →
          </Link>
        </section>
      )}

      {topScorers.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-bold">Artilharia</h2>
          <ol className="flex flex-col gap-1">
            {topScorers.map((scorer, i) => (
              <li
                key={scorer.name}
                className="flex items-center gap-3 rounded-lg border border-neutral-200 bg-white px-4 py-2 dark:border-neutral-800 dark:bg-neutral-900"
              >
                <span className="text-lg">{["🥇", "🥈", "🥉"][i]}</span>
                <span className="font-medium">{scorer.name}</span>
                <span className="ml-auto text-sm text-neutral-500">
                  {scorer.total} gol{scorer.total === 1 ? "" : "s"}
                </span>
              </li>
            ))}
          </ol>
          <Link
            href="/artilharia"
            className="mt-2 inline-block text-sm font-medium text-emerald-700 hover:underline dark:text-emerald-400"
          >
            Ranking completo →
          </Link>
        </section>
      )}
    </div>
  );
}
