import Link from "next/link";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { matchDays } from "@/db/schema";
import { formatDate, formatDateShort, formatTime, todayISO } from "@/lib/format";
import { createMatchDay } from "./actions";

const inputClass =
  "rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-emerald-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100";

const statusLabels = {
  scheduled: "marcada",
  teams_drawn: "times sorteados",
  finished: "encerrada",
} as const;

export default async function AdminPeladasPage({ searchParams }: PageProps<"/admin/peladas">) {
  const { erro } = await searchParams;
  const days = await db.select().from(matchDays).orderBy(desc(matchDays.date), desc(matchDays.id));

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Peladas</h1>

      {erro === "dados-invalidos" && (
        <p className="rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          Dados inválidos — confira data e local.
        </p>
      )}

      <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="mb-3 font-bold">Marcar pelada</h2>
        <form action={createMatchDay} className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Data
            <input name="date" type="date" required defaultValue={todayISO()} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Horário
            <input name="startTime" type="time" className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Local
            <input name="location" required placeholder="Quadra do clube" className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Observações
            <input name="notes" className={inputClass} />
          </label>
          <button
            type="submit"
            className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800"
          >
            Criar
          </button>
        </form>
      </section>

      <section className="flex flex-col gap-2">
        {days.length === 0 && <p className="text-sm text-neutral-500">Nenhuma pelada ainda.</p>}
        {days.map((day) => (
          <Link
            key={day.id}
            href={`/admin/peladas/${day.id}`}
            className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-white px-4 py-3 shadow-sm hover:border-emerald-600 dark:border-neutral-800 dark:bg-neutral-900"
          >
            <div>
              <span className="font-medium capitalize">{formatDate(day.date)}</span>{" "}
              <span className="text-sm text-neutral-500">{formatDateShort(day.date)}</span>
              <p className="text-sm text-neutral-500">
                {formatTime(day.startTime) && <>{formatTime(day.startTime)} · </>}
                {day.location}
              </p>
            </div>
            <span className="ml-auto rounded-full bg-neutral-200 px-2 py-0.5 text-xs font-medium dark:bg-neutral-800">
              {statusLabels[day.status]}
            </span>
          </Link>
        ))}
      </section>
    </div>
  );
}
