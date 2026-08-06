import Link from "next/link";
import { todayISO } from "@/lib/format";
import { requirePlayer } from "@/lib/require-player";
import { createMatchDay } from "./actions";

export const metadata = { title: "Marcar pelada" };

const inputClass =
  "rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-emerald-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100";

const errorMessages: Record<string, string> = {
  "dados-invalidos": "Dados inválidos — confira data e local.",
};

export default async function NovaPeladaPage({ searchParams }: PageProps<"/peladas/nova">) {
  await requirePlayer();
  const { erro } = await searchParams;
  const mensagemErro = typeof erro === "string" ? errorMessages[erro] : undefined;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">Marcar pelada</h1>
        <p className="text-sm text-neutral-500">
          Você fica responsável por ela: sorteio dos times, presenças, placar, gols e o
          encerramento.
        </p>
      </header>

      {mensagemErro && (
        <p className="rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {mensagemErro}
        </p>
      )}

      <form
        action={createMatchDay}
        className="flex flex-col gap-3 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900"
      >
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Data
            <input name="date" type="date" required defaultValue={todayISO()} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Horário
            <input name="startTime" type="time" className={inputClass} />
          </label>
        </div>
        <label className="flex flex-col gap-1 text-sm">
          Local
          <input name="location" required placeholder="Quadra do clube" className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Observações
          <input name="notes" placeholder="Opcional" className={inputClass} />
        </label>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800"
          >
            Criar pelada
          </button>
          <Link href="/peladas" className="text-sm text-neutral-500 hover:underline">
            Cancelar
          </Link>
        </div>
      </form>
    </div>
  );
}
