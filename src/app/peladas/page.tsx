import Link from "next/link";
import { desc, asc, inArray } from "drizzle-orm";
import { db } from "@/db";
import { games, matchDays, teams } from "@/db/schema";
import { formatDate, formatDateShort, formatTime } from "@/lib/format";

export const metadata = { title: "Peladas" };
export const dynamic = "force-dynamic";

export default async function PeladasPage() {
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
      <h1 className="text-2xl font-bold">Peladas</h1>
      {days.length === 0 && <p className="text-neutral-500">Nenhuma pelada marcada ainda.</p>}
      <div className="flex flex-col gap-2">
        {days.map((day) => {
          const dayGames = gameRows.filter((g) => g.matchDayId === day.id);
          return (
            <Link
              key={day.id}
              href={`/pelada/${day.id}`}
              className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm hover:border-emerald-600 dark:border-neutral-800 dark:bg-neutral-900"
            >
              <div className="flex items-center gap-2">
                <span className="font-bold capitalize">{formatDate(day.date)}</span>
                <span className="text-sm text-neutral-500">{formatDateShort(day.date)}</span>
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
