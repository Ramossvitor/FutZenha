import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { attendances, games, goals, matchDays, players, teamPlayers, teams } from "@/db/schema";
import { formatDate, formatTime } from "@/lib/format";
import { getGrupo, papelNoGrupo } from "@/lib/grupos";
import { podeGerenciarPelada } from "@/lib/permissions";
import { getSession } from "@/lib/session";
import { vestClass } from "@/lib/team-colors";
import { setMyAttendance } from "./actions";

const statusLabels = {
  scheduled: "Marcada",
  teams_drawn: "Times sorteados",
  finished: "Encerrada",
} as const;

export default async function PeladaPage({ params }: PageProps<"/pelada/[id]">) {
  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id)) notFound();

  const session = await getSession();
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
  const confirmedCount = attendanceRows.filter((a) => a.status === "in").length;

  const teamList = await db
    .select()
    .from(teams)
    .where(eq(teams.matchDayId, id))
    .orderBy(asc(teams.sortOrder));
  const teamMembers =
    teamList.length > 0
      ? await db
          .select({
            teamId: teamPlayers.teamId,
            playerName: players.name,
            isGoalkeeper: players.isGoalkeeper,
          })
          .from(teamPlayers)
          .innerJoin(players, eq(teamPlayers.playerId, players.id))
          .where(
            inArray(
              teamPlayers.teamId,
              teamList.map((t) => t.id),
            ),
          )
          .orderBy(asc(players.name))
      : [];

  const gameList = await db
    .select()
    .from(games)
    .where(eq(games.matchDayId, id))
    .orderBy(asc(games.sortOrder), asc(games.id));
  const goalRows =
    gameList.length > 0
      ? await db
          .select({
            gameId: goals.gameId,
            quantity: goals.quantity,
            playerName: players.name,
          })
          .from(goals)
          .innerJoin(players, eq(goals.playerId, players.id))
          .where(
            inArray(
              goals.gameId,
              gameList.map((g) => g.id),
            ),
          )
      : [];
  const teamNameById = new Map(teamList.map((t) => [t.id, t.name]));

  const canToggle = matchDay.status === "scheduled";
  const myPlayerId = session?.player.id ?? null;
  // Em pelada de grupo, o admin do grupo também gerencia — e o papel sai do
  // groupId da própria pelada, nunca de um id vindo da URL.
  const papel =
    session && matchDay.groupId !== null
      ? await papelNoGrupo(matchDay.groupId, session.player.id)
      : null;
  const grupo = matchDay.groupId !== null ? await getGrupo(matchDay.groupId) : undefined;
  const podeGerenciar =
    session !== null &&
    podeGerenciarPelada(
      { playerId: session.player.id, isPlatformAdmin: session.isPlatformAdmin },
      matchDay,
      papel,
    );

  // Grupo privado não vira link para quem está de fora: o 404 do guard não
  // adianta nada se a própria pelada anuncia o nome e o id do grupo.
  const grupoVisivel = grupo && (grupo.visibility === "public" || papel !== null);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold capitalize">{formatDate(matchDay.date)}</h1>
          <span className="rounded-full bg-neutral-200 px-2 py-0.5 text-xs font-medium dark:bg-neutral-800">
            {statusLabels[matchDay.status]}
          </span>
        </div>
        <p className="text-neutral-500">
          {formatTime(matchDay.startTime) && <>{formatTime(matchDay.startTime)} · </>}
          {matchDay.location}
        </p>
        {grupoVisivel && (
          <p className="text-sm text-neutral-500">
            Pelada do grupo{" "}
            <Link
              href={`/grupo/${grupo.id}`}
              className="text-emerald-700 hover:underline dark:text-emerald-400"
            >
              {grupo.name}
            </Link>
          </p>
        )}
        {matchDay.notes && <p className="text-sm text-neutral-500">{matchDay.notes}</p>}
      </header>

      {teamList.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-bold">Times</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {teamList.map((team) => (
              <div
                key={team.id}
                className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900"
              >
                <span
                  className={`mb-2 inline-block rounded-full px-3 py-1 text-sm font-bold ${vestClass(team.name)}`}
                >
                  {team.name}
                </span>
                <ul className="flex flex-col gap-1 text-sm">
                  {teamMembers
                    .filter((m) => m.teamId === team.id)
                    .map((m) => (
                      <li key={m.playerName}>
                        {m.isGoalkeeper ? "🧤 " : ""}
                        {m.playerName}
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      {gameList.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-bold">Jogos</h2>
          <div className="flex flex-col gap-2">
            {gameList.map((game) => {
              const gameGoals = goalRows.filter((g) => g.gameId === game.id);
              return (
                <div
                  key={game.id}
                  className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900"
                >
                  <p className="text-center font-bold">
                    {teamNameById.get(game.teamAId)} {game.scoreA} × {game.scoreB}{" "}
                    {teamNameById.get(game.teamBId)}
                  </p>
                  {gameGoals.length > 0 && (
                    <p className="mt-1 text-center text-sm text-neutral-500">
                      ⚽{" "}
                      {gameGoals
                        .map((g) => (g.quantity > 1 ? `${g.playerName} (${g.quantity})` : g.playerName))
                        .join(", ")}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-bold">
          Presença{" "}
          <span className="text-sm font-normal text-neutral-500">
            ({confirmedCount} confirmado{confirmedCount === 1 ? "" : "s"})
          </span>
        </h2>
        {!canToggle && (
          <p className="text-sm text-neutral-500">
            {matchDay.status === "teams_drawn"
              ? "Os times já foram sorteados — fala com quem organiza a pelada para mudar a presença."
              : "Pelada encerrada."}
          </p>
        )}
        {canToggle && !session && (
          <p className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm dark:border-emerald-800 dark:bg-emerald-950">
            <Link
              href={`/login?next=/pelada/${matchDay.id}`}
              className="font-medium text-emerald-700 hover:underline dark:text-emerald-400"
            >
              Entre na sua conta
            </Link>{" "}
            para marcar presença.
          </p>
        )}
        {podeGerenciar && (
          <p className="text-sm text-neutral-500">
            Você administra esta pelada —{" "}
            <Link href={`/pelada/${matchDay.id}/gerenciar`} className="underline">
              abrir o painel
            </Link>
            .
          </p>
        )}
        <ul className="flex flex-col gap-1">
          {activePlayers.map((player) => {
            const status = statusByPlayer.get(player.id);
            const isMe = myPlayerId === player.id;
            return (
              <li
                key={player.id}
                className={`flex items-center gap-2 rounded-lg border bg-white px-3 py-2 dark:bg-neutral-900 ${
                  isMe
                    ? "border-emerald-400 dark:border-emerald-700"
                    : "border-neutral-200 dark:border-neutral-800"
                }`}
              >
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
                  {player.nickname ? ` (${player.nickname})` : ""}
                </span>
                {isMe && (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
                    você
                  </span>
                )}
                {status === "in" && <span className="text-sm text-emerald-600">✓</span>}
                {canToggle && isMe && (
                  <span className="ml-auto flex gap-1">
                    {status !== "in" && (
                      <form action={setMyAttendance.bind(null, matchDay.id, "in")}>
                        <button
                          type="submit"
                          className="rounded-lg bg-emerald-700 px-3 py-1 text-sm font-medium text-white hover:bg-emerald-800"
                        >
                          Vou
                        </button>
                      </form>
                    )}
                    {status !== "out" && (
                      <form action={setMyAttendance.bind(null, matchDay.id, "out")}>
                        <button
                          type="submit"
                          className="rounded-lg border border-neutral-300 px-3 py-1 text-sm text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                        >
                          Fora
                        </button>
                      </form>
                    )}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
        <p className="text-xs text-neutral-400">
          Não está na lista ou não tem conta? Fala com quem organiza a pelada.
        </p>
      </section>
    </div>
  );
}
