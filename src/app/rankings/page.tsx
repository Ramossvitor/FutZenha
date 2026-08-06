import Link from "next/link";
import { formatSkill } from "@/lib/format";
import {
  getAttendanceStats,
  getAvailableYears,
  getPlayerRecords,
  getSkillRanking,
} from "@/lib/stats";

export const metadata = { title: "Rankings" };
export const dynamic = "force-dynamic";

const MIN_GAMES = 3;

export default async function RankingsPage({ searchParams }: PageProps<"/rankings">) {
  const { ano } = await searchParams;
  const year = typeof ano === "string" && /^\d{4}$/.test(ano) ? Number(ano) : undefined;
  const [records, attendance, years, notas] = await Promise.all([
    getPlayerRecords(year, MIN_GAMES),
    getAttendanceStats(year),
    getAvailableYears(),
    getSkillRanking(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Rankings</h1>

      <nav className="flex flex-wrap gap-2 text-sm">
        <Link
          href="/rankings"
          className={`rounded-full px-3 py-1 font-medium ${!year ? "bg-emerald-700 text-white" : "border border-neutral-300 dark:border-neutral-700"}`}
        >
          Geral
        </Link>
        {years.map((y) => (
          <Link
            key={y}
            href={`/rankings?ano=${y}`}
            className={`rounded-full px-3 py-1 font-medium ${year === y ? "bg-emerald-700 text-white" : "border border-neutral-300 dark:border-neutral-700"}`}
          >
            {y}
          </Link>
        ))}
      </nav>

      {/* A nota é estado atual do jogador, não acumulado de temporada — por
          isso a seção fica fora do filtro por ano. */}
      <section>
        <h2 className="mb-1 text-lg font-bold">Notas</h2>
        <p className="mb-3 text-xs text-neutral-500">
          Calculada pelas avaliações dos companheiros depois de cada pelada. Todo mundo começa em
          5,0. A variação é da última pelada apurada.
        </p>
        {notas.length === 0 ? (
          <p className="text-neutral-500">Ninguém com acesso ao sistema ainda.</p>
        ) : (
          <ol className="flex flex-col gap-1">
            {notas.map((n, i) => (
              <li
                key={n.playerId}
                className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-white px-4 py-2 dark:border-neutral-800 dark:bg-neutral-900"
              >
                <span className="w-6 text-sm text-neutral-400">{i + 1}º</span>
                <span className="font-medium">{n.name}</span>
                {n.nickname && <span className="text-sm text-neutral-500">“{n.nickname}”</span>}
                {n.variacao !== null && n.variacao !== 0 && (
                  <span
                    className={`text-xs font-medium ${
                      n.variacao > 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-red-600 dark:text-red-400"
                    }`}
                  >
                    {n.variacao > 0 ? "▲" : "▼"} {formatSkill(Math.abs(n.variacao))}
                  </span>
                )}
                <span className="ml-auto text-lg font-bold">{formatSkill(n.skill)}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section>
        <h2 className="mb-1 text-lg font-bold">Aproveitamento</h2>
        <p className="mb-3 text-xs text-neutral-500">
          Vitória = 100%, empate = 50%. Mínimo de {MIN_GAMES} jogos para entrar no ranking.
        </p>
        {records.length === 0 ? (
          <p className="text-neutral-500">Sem jogos suficientes ainda.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800">
            <table className="w-full min-w-105 bg-white text-sm dark:bg-neutral-900">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500 dark:border-neutral-800">
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">Jogador</th>
                  <th className="px-3 py-2 text-center">J</th>
                  <th className="px-3 py-2 text-center">V</th>
                  <th className="px-3 py-2 text-center">E</th>
                  <th className="px-3 py-2 text-center">D</th>
                  <th className="px-3 py-2 text-right">Aprov.</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r, i) => (
                  <tr
                    key={r.playerId}
                    className="border-b border-neutral-100 last:border-0 dark:border-neutral-800"
                  >
                    <td className="px-3 py-2 text-neutral-400">{i + 1}º</td>
                    <td className="px-3 py-2 font-medium">
                      {r.name}
                      {r.nickname ? ` (${r.nickname})` : ""}
                    </td>
                    <td className="px-3 py-2 text-center">{r.gamesPlayed}</td>
                    <td className="px-3 py-2 text-center text-emerald-700 dark:text-emerald-400">
                      {r.wins}
                    </td>
                    <td className="px-3 py-2 text-center text-neutral-500">{r.draws}</td>
                    <td className="px-3 py-2 text-center text-red-600">{r.losses}</td>
                    <td className="px-3 py-2 text-right font-bold">
                      {(r.winRate * 100).toFixed(0)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-1 text-lg font-bold">Presença</h2>
        <p className="mb-3 text-xs text-neutral-500">
          Peladas encerradas{year ? ` em ${year}` : ""}: {attendance.totalDays}
        </p>
        {attendance.perPlayer.length === 0 ? (
          <p className="text-neutral-500">Nenhuma presença registrada ainda.</p>
        ) : (
          <ol className="flex flex-col gap-1">
            {attendance.perPlayer.map((p, i) => (
              <li
                key={p.playerId}
                className="flex items-center gap-3 rounded-lg border border-neutral-200 bg-white px-4 py-2 text-sm dark:border-neutral-800 dark:bg-neutral-900"
              >
                <span className="w-8 text-center font-bold text-neutral-400">{i + 1}º</span>
                <span className="font-medium">{p.name}</span>
                <span className="ml-auto text-neutral-500">
                  {p.attended}/{attendance.totalDays}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
