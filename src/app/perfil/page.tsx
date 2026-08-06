import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { mensagemDeErro } from "@/lib/erros-login";
import { formatDate, formatSkill } from "@/lib/format";
import { googleLoginConfigurado } from "@/lib/google-oauth";
import { getEstrelasRecebidas } from "@/lib/ratings";
import { requirePlayer } from "@/lib/require-player";
import { getAttendanceStats, getPlayerRecords, getTopScorers } from "@/lib/stats";
import { GoogleButton } from "../google-button";
import { ChangePasswordForm } from "./change-password-form";
import { DenunciarForm } from "./denunciar-form";

export const metadata: Metadata = { title: "Meu perfil" };

export default async function PerfilPage({ searchParams }: PageProps<"/perfil">) {
  const session = await requirePlayer();
  const { player } = session;
  const { erro } = await searchParams;

  const [scorers, records, attendance, rodadas, [conta]] = await Promise.all([
    getTopScorers(),
    getPlayerRecords(),
    getAttendanceStats(),
    getEstrelasRecebidas(player.id),
    db
      .select({ email: users.email, googleSub: users.googleSub, passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, session.userId)),
  ]);
  const myGoals = scorers.find((s) => s.playerId === player.id)?.total ?? 0;
  const myRecord = records.find((r) => r.playerId === player.id);
  const myAttendance = attendance.perPlayer.find((a) => a.playerId === player.id)?.attended ?? 0;

  const statCards = [
    { label: "Nota", value: formatSkill(player.skill) },
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
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
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
            Você está fora das listas no momento — fala com o admin da plataforma para voltar.
          </p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-bold">Avaliações que recebi</h2>
        {rodadas.length === 0 ? (
          <p className="rounded-xl border border-neutral-200 bg-white p-4 text-sm text-neutral-500 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
            Nenhuma ainda. Depois que uma pelada que você jogou for apurada, as estrelas que os
            companheiros te deram aparecem aqui.
          </p>
        ) : (
          rodadas.map((rodada) => (
            <div
              key={rodada.roundId}
              className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900"
            >
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="font-medium capitalize">{formatDate(rodada.matchDayDate)}</span>
                {rodada.skillBefore !== null && rodada.skillAfter !== null && (
                  <span className="text-sm text-neutral-500">
                    nota {formatSkill(rodada.skillBefore)} → {formatSkill(rodada.skillAfter)}
                  </span>
                )}
                <span className="ml-auto text-xs text-neutral-400">
                  as avaliações são anônimas
                </span>
              </div>
              <ul className="flex flex-col gap-2">
                {rodada.estrelas.map((e) => (
                  <li
                    key={e.indice}
                    className="flex flex-wrap items-center gap-2 border-t border-neutral-100 pt-2 first:border-0 first:pt-0 dark:border-neutral-800"
                  >
                    <span
                      className={e.descartada ? "text-neutral-300 line-through dark:text-neutral-600" : "text-amber-400"}
                    >
                      {"★".repeat(e.stars)}
                      <span className="text-neutral-200 dark:text-neutral-700">
                        {"★".repeat(5 - e.stars)}
                      </span>
                    </span>
                    {e.descartada && (
                      <span className="rounded-full bg-neutral-200 px-2 py-0.5 text-xs text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300">
                        descartada
                      </span>
                    )}
                    {e.denunciaStatus === "open" && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-900 dark:text-amber-200">
                        em análise
                      </span>
                    )}
                    {e.denunciaStatus === "rejected" && (
                      <span className="rounded-full bg-neutral-200 px-2 py-0.5 text-xs text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300">
                        considerada justa
                      </span>
                    )}
                    <span className="ml-auto">
                      {rodada.podeDenunciar && e.denunciaStatus === null && !e.descartada && (
                        <DenunciarForm roundId={rodada.roundId} indice={e.indice} />
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </section>

      <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900 sm:max-w-sm">
        <h2 className="mb-3 font-bold">Acesso</h2>

        {mensagemDeErro(erro) && (
          <p className="mb-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
            {mensagemDeErro(erro)}
          </p>
        )}

        {conta?.googleSub ? (
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            Conta Google vinculada: <strong>{conta.email}</strong>
          </p>
        ) : (
          googleLoginConfigurado() && (
            <>
              <GoogleButton
                href="/api/auth/google?vincular=1&next=/perfil"
                label="Conectar conta Google"
              />
              <p className="mt-2 text-xs text-neutral-500">
                Depois de conectar, você entra pelo Google. Vincular encerra suas sessões nos
                outros aparelhos.
              </p>
            </>
          )
        )}
      </section>

      {/* Conta que nasceu pelo Google nunca teve senha — não há o que trocar. */}
      {conta?.passwordHash && (
        <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900 sm:max-w-sm">
          <h2 className="mb-3 font-bold">Trocar senha</h2>
          <ChangePasswordForm />
        </section>
      )}
    </div>
  );
}
