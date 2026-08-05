import Link from "next/link";
import { getAvailableYears, getTopScorers } from "@/lib/stats";

export const metadata = { title: "Artilharia" };
export const dynamic = "force-dynamic";

export default async function ArtilhariaPage({ searchParams }: PageProps<"/artilharia">) {
  const { ano } = await searchParams;
  const year = typeof ano === "string" && /^\d{4}$/.test(ano) ? Number(ano) : undefined;
  const [scorers, years] = await Promise.all([getTopScorers(year), getAvailableYears()]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Artilharia</h1>

      <nav className="flex flex-wrap gap-2 text-sm">
        <Link
          href="/artilharia"
          className={`rounded-full px-3 py-1 font-medium ${!year ? "bg-emerald-700 text-white" : "border border-neutral-300 dark:border-neutral-700"}`}
        >
          Geral
        </Link>
        {years.map((y) => (
          <Link
            key={y}
            href={`/artilharia?ano=${y}`}
            className={`rounded-full px-3 py-1 font-medium ${year === y ? "bg-emerald-700 text-white" : "border border-neutral-300 dark:border-neutral-700"}`}
          >
            {y}
          </Link>
        ))}
      </nav>

      {scorers.length === 0 ? (
        <p className="text-neutral-500">Nenhum gol registrado ainda.</p>
      ) : (
        <ol className="flex flex-col gap-1">
          {scorers.map((scorer, i) => (
            <li
              key={scorer.playerId}
              className="flex items-center gap-3 rounded-lg border border-neutral-200 bg-white px-4 py-2 dark:border-neutral-800 dark:bg-neutral-900"
            >
              <span className="w-8 text-center font-bold text-neutral-400">
                {i < 3 ? ["🥇", "🥈", "🥉"][i] : `${i + 1}º`}
              </span>
              <span className="font-medium">
                {scorer.name}
                {scorer.nickname ? ` (${scorer.nickname})` : ""}
              </span>
              <span className="ml-auto font-bold text-emerald-700 dark:text-emerald-400">
                {scorer.total}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
