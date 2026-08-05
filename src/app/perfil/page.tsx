import type { Metadata } from "next";
import { requirePlayer } from "@/lib/require-player";
import { getAttendanceStats, getPlayerRecords, getTopScorers } from "@/lib/stats";
import { ChangePasswordForm } from "./change-password-form";

export const metadata: Metadata = { title: "Meu perfil" };

// A nota (skill) é segredo do admin — nunca aparece aqui.
export default async function PerfilPage() {
  const session = await requirePlayer();
  const { player } = session;

  const [scorers, records, attendance] = await Promise.all([
    getTopScorers(),
    getPlayerRecords(),
    getAttendanceStats(),
  ]);
  const myGoals = scorers.find((s) => s.playerId === player.id)?.total ?? 0;
  const myRecord = records.find((r) => r.playerId === player.id);
  const myAttendance = attendance.perPlayer.find((a) => a.playerId === player.id)?.attended ?? 0;

  const statCards = [
    { label: "Gols", value: String(myGoals) },
    { label: "Jogos", value: String(myRecord?.gamesPlayed ?? 0) },
    {
      label: "V · E · D",
      value: myRecord ? `${myRecord.wins} · ${myRecord.draws} · ${myRecord.losses}` : "0 · 0 · 0",
    },
    {
      label: "Aproveitamento",
      value: myRecord ? `${Math.round(myRecord.winRate * 100)}%` : "—",
    },
    { label: "Presenças", value: `${myAttendance} de ${attendance.totalDays}` },
  ];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold">{player.name}</h1>
        {player.nickname && <span className="text-neutral-500">“{player.nickname}”</span>}
        <span className="rounded-full bg-neutral-200 px-2 py-0.5 text-xs font-medium dark:bg-neutral-800">
          @{session.username}
        </span>
        {player.isGoalkeeper && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900 dark:text-amber-200">
            🧤 goleiro
          </span>
        )}
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-bold">
          Meus números{" "}
          <span className="text-sm font-normal text-neutral-500">(só peladas encerradas)</span>
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {statCards.map((card) => (
            <div
              key={card.label}
              className="rounded-xl border border-neutral-200 bg-white p-4 text-center shadow-sm dark:border-neutral-800 dark:bg-neutral-900"
            >
              <p className="text-xl font-bold">{card.value}</p>
              <p className="text-xs text-neutral-500">{card.label}</p>
            </div>
          ))}
        </div>
        {!player.active && (
          <p className="text-sm text-neutral-500">
            Você está fora das listas no momento — fala com o admin para voltar.
          </p>
        )}
      </section>

      <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900 sm:max-w-sm">
        <h2 className="mb-3 font-bold">Trocar senha</h2>
        <ChangePasswordForm />
      </section>
    </div>
  );
}
