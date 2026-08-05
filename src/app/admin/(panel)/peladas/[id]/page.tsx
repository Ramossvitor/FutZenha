import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { attendances, matchDays, players } from "@/db/schema";
import { formatDate, formatTime } from "@/lib/format";
import { deleteMatchDay, setAttendanceAdmin, updateMatchDay } from "../actions";

const inputClass =
  "rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-emerald-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100";

const statusLabels = {
  scheduled: "Marcada",
  teams_drawn: "Times sorteados",
  finished: "Encerrada",
} as const;

export default async function AdminPeladaPage({ params }: PageProps<"/admin/peladas/[id]">) {
  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id)) notFound();

  const [matchDay] = await db.select().from(matchDays).where(eq(matchDays.id, id));
  if (!matchDay) notFound();

  const activePlayers = await db
    .select()
    .from(players)
    .where(eq(players.active, true))
    .orderBy(asc(players.name));
  const attendanceRows = await db
    .select()
    .from(attendances)
    .where(eq(attendances.matchDayId, id));
  const statusByPlayer = new Map(attendanceRows.map((a) => [a.playerId, a.status]));
  const confirmed = activePlayers.filter((p) => statusByPlayer.get(p.id) === "in");

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold capitalize">{formatDate(matchDay.date)}</h1>
        <span className="rounded-full bg-neutral-200 px-2 py-0.5 text-xs font-medium dark:bg-neutral-800">
          {statusLabels[matchDay.status]}
        </span>
        <Link
          href={`/pelada/${matchDay.id}`}
          className="ml-auto text-sm font-medium text-emerald-700 hover:underline dark:text-emerald-400"
        >
          Ver página pública →
        </Link>
      </header>

      <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="mb-3 font-bold">Dados da pelada</h2>
        <form action={updateMatchDay.bind(null, matchDay.id)} className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Data
            <input name="date" type="date" required defaultValue={matchDay.date} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Horário
            <input
              name="startTime"
              type="time"
              defaultValue={formatTime(matchDay.startTime) ?? ""}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Local
            <input name="location" required defaultValue={matchDay.location} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Observações
            <input name="notes" defaultValue={matchDay.notes ?? ""} className={inputClass} />
          </label>
          <button
            type="submit"
            className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800"
          >
            Salvar
          </button>
        </form>
      </section>

      <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="mb-1 font-bold">
          Presença{" "}
          <span className="text-sm font-normal text-neutral-500">({confirmed.length} confirmados)</span>
        </h2>
        <p className="mb-3 text-xs text-neutral-500">
          Override do admin — vale mesmo depois do sorteio.
        </p>
        <ul className="flex flex-col gap-1">
          {activePlayers.map((player) => {
            const status = statusByPlayer.get(player.id);
            return (
              <li key={player.id} className="flex items-center gap-2 py-1">
                <span
                  className={
                    status === "in"
                      ? "font-medium text-emerald-700 dark:text-emerald-400"
                      : status === "out"
                        ? "text-neutral-400 line-through"
                        : ""
                  }
                >
                  {player.name}
                </span>
                <span className="ml-auto flex gap-1">
                  {status !== "in" && (
                    <form action={setAttendanceAdmin.bind(null, matchDay.id, player.id, "in")}>
                      <button
                        type="submit"
                        className="rounded-lg bg-emerald-700 px-3 py-1 text-sm font-medium text-white hover:bg-emerald-800"
                      >
                        Vai
                      </button>
                    </form>
                  )}
                  {status !== "out" && (
                    <form action={setAttendanceAdmin.bind(null, matchDay.id, player.id, "out")}>
                      <button
                        type="submit"
                        className="rounded-lg border border-neutral-300 px-3 py-1 text-sm text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                      >
                        Fora
                      </button>
                    </form>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="rounded-xl border border-red-200 bg-white p-4 dark:border-red-900 dark:bg-neutral-900">
        <form action={deleteMatchDay.bind(null, matchDay.id)}>
          <button type="submit" className="text-sm text-red-600 hover:underline">
            Excluir esta pelada (apaga presenças, times e resultados)
          </button>
        </form>
      </section>
    </div>
  );
}
