import Link from "next/link";
import { formatSkill } from "@/lib/format";
import { requireGrupoMembro } from "@/lib/require-grupo";
import {
  getAttendanceStats,
  getAvailableYears,
  getPlayerRecords,
  getSkillRanking,
  getTopScorers,
} from "@/lib/stats";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ranking do grupo" };

const MIN_GAMES = 3;

const medals = ["🥇", "🥈", "🥉"];

/**
 * O ranking do grupo: as mesmas quatro consultas de /rankings e /artilharia,
 * recortadas pelas peladas deste grupo (ver EscopoStats em src/lib/stats.ts).
 *
 * Quem aparece é quem JOGOU as peladas do grupo — membro ou não. O convidado de
 * fora que fez três gols conta na artilharia daqui; a única exclusão é a de
 * sempre, quem não tem conta ativa.
 */
export default async function RankingDoGrupoPage({
  params,
  searchParams,
}: PageProps<"/grupo/[id]/ranking">) {
  const { id } = await params;
  const groupId = Number(id);
  const { grupo } = await requireGrupoMembro(groupId);

  const { ano } = await searchParams;
  const year = typeof ano === "string" && /^\d{4}$/.test(ano) ? Number(ano) : undefined;

  const [records, attendance, years, notas, scorers] = await Promise.all([
    getPlayerRecords({ year, groupId }, MIN_GAMES),
    getAttendanceStats({ year, groupId }),
    getAvailableYears({ groupId }),
    getSkillRanking({ groupId }),
    getTopScorers({ year, groupId }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold">Ranking de {grupo.name}</h1>
          <Link
            href={`/grupo/${groupId}`}
            className="ml-auto text-sm text-emerald-700 hover:underline dark:text-emerald-400"
          >
            Ver o grupo
          </Link>
        </div>
        <p className="text-sm text-neutral-500">
          Só as peladas deste grupo. As estatísticas também continuam contando para os{" "}
          <Link href="/rankings" className="text-emerald-700 hover:underline dark:text-emerald-400">
            rankings gerais
          </Link>{" "}
          da plataforma.
        </p>
      </header>

      <nav className="flex flex-wrap gap-2 text-sm">
        <Link
          href={`/grupo/${groupId}/ranking`}
          className={`rounded-full px-3 py-1 font-medium ${!year ? "bg-emerald-700 text-white" : "border border-neutral-300 dark:border-neutral-700"}`}
        >
          Geral
        </Link>
        {years.map((y) => (
          <Link
            key={y}
            href={`/grupo/${groupId}/ranking?ano=${y}`}
            className={`rounded-full px-3 py-1 font-medium ${year === y ? "bg-emerald-700 text-white" : "border border-neutral-300 dark:border-neutral-700"}`}
          >
            {y}
          </Link>
        ))}
      </nav>

      <section>
        <h2 className="mb-1 text-lg font-bold">Notas</h2>
        {/* A nota é global e não tem versão por grupo: aqui a lista é só
            restrita a quem jogou as peladas deste grupo. Dizer isso na tela
            evita a leitura errada de que existe uma nota "do grupo". */}
        <p className="mb-3 text-xs text-neutral-500">
          Nota geral da plataforma — a lista mostra quem jogou as peladas deste grupo. Fora do
          filtro por ano: a nota é o estado atual do jogador, não um acumulado de temporada.
        </p>
        {notas.length === 0 ? (
          <p className="text-neutral-500">Ninguém com conta jogou uma pelada encerrada ainda.</p>
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
        <h2 className="mb-1 text-lg font-bold">Artilharia</h2>
        <p className="mb-3 text-xs text-neutral-500">
          Gols nas peladas encerradas do grupo{year ? ` em ${year}` : ""}.
        </p>
        {scorers.length === 0 ? (
          <p className="text-neutral-500">Nenhum gol registrado ainda.</p>
        ) : (
          <ol className="flex flex-col gap-1">
            {scorers.map((s, i) => (
              <li
                key={s.playerId}
                className="flex items-center gap-3 rounded-lg border border-neutral-200 bg-white px-4 py-2 text-sm dark:border-neutral-800 dark:bg-neutral-900"
              >
                <span className="w-8 text-center font-bold text-neutral-400">
                  {medals[i] ?? `${i + 1}º`}
                </span>
                <span className="font-medium">{s.name}</span>
                {s.nickname && <span className="text-neutral-500">“{s.nickname}”</span>}
                <span className="ml-auto font-bold">{s.total}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section>
        <h2 className="mb-1 text-lg font-bold">Aproveitamento</h2>
        <p className="mb-3 text-xs text-neutral-500">
          Vitória = 100%, empate = 50%. Mínimo de {MIN_GAMES} jogos no grupo.
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
          Peladas do grupo encerradas{year ? ` em ${year}` : ""}: {attendance.totalDays}
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
