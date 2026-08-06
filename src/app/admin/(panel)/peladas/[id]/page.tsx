import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq, getTableColumns, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  attendances,
  gamePlayers,
  games,
  goals,
  matchDays,
  players,
  teamPlayers,
  teams,
} from "@/db/schema";
import { getFaltamVotar, getVotacaoDaPelada } from "@/lib/deletion";
import { formatDate, formatSkill, formatTime } from "@/lib/format";
import { vestClass } from "@/lib/team-colors";
import { BuscaJogador, type ItemJogador } from "./busca-jogador";
import {
  abrirVotacaoExclusao,
  addGoal,
  createGame,
  deleteGame,
  deleteGoal,
  deleteMatchDay,
  drawTeamsAction,
  setAttendanceAdmin,
  swapPlayersAction,
  updateGameScore,
  updateMatchDay,
} from "../actions";

const inputClass =
  "rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-emerald-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100";

const statusLabels = {
  scheduled: "Marcada",
  teams_drawn: "Times sorteados",
  finished: "Encerrada",
} as const;

const errorMessages: Record<string, string> = {
  "dados-invalidos": "Dados inválidos — confira os campos.",
  "pelada-encerrada": "A pelada já foi encerrada.",
  "poucos-jogadores": "Confirmados insuficientes para esse número de times.",
  "jogos-lancados": "Já existem jogos lançados — apague os jogos antes de re-sortear.",
  "precisa-votacao":
    "Pelada encerrada não se apaga direto — abra a votação de exclusão para o grupo decidir.",
  "motivo-curto": "Explique em pelo menos 10 caracteres por que a pelada deve ser apagada.",
  "escalacao-travada":
    "A pelada já foi encerrada e a escalação não muda mais. Para corrigir, é preciso excluir a pelada — o que exige votação dos jogadores.",
  "janela-encerrada":
    "As 24h para corrigir placar e gols já passaram. Para alterar, é preciso excluir a pelada — o que exige votação dos jogadores.",
};

export default async function AdminPeladaPage({
  params,
  searchParams,
}: PageProps<"/admin/peladas/[id]">) {
  const { id: idParam } = await params;
  const { erro } = await searchParams;
  const id = Number(idParam);
  if (!Number.isInteger(id)) notFound();

  // A janela de correção vem calculada pelo Postgres — a regra de pureza do
  // React proíbe Date.now() durante o render.
  const [matchDay] = await db
    .select({
      ...getTableColumns(matchDays),
      segundosDeJanela: sql<number>`greatest(0, extract(epoch from (
        ${matchDays.finishedAt} + interval '24 hours' - now()
      ))::int)`,
    })
    .from(matchDays)
    .where(eq(matchDays.id, id));
  if (!matchDay) notFound();
  const errorMessage = typeof erro === "string" ? errorMessages[erro] : undefined;

  const dentroDaJanela = matchDay.finishedAt !== null && matchDay.segundosDeJanela > 0;
  // Placar e gols não mexem em quem avalia quem, então sobrevivem ao
  // encerramento por 24h. A escalação, não: some do formulário na hora.
  const podeEditarPlacar = matchDay.status !== "finished" || dentroDaJanela;
  const horas = Math.floor(matchDay.segundosDeJanela / 3600);
  const minutos = Math.floor((matchDay.segundosDeJanela % 3600) / 60);
  const horasRestantes = horas > 0 ? `${horas}h${String(minutos).padStart(2, "0")}` : `${minutos}min`;

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
            playerId: players.id,
            playerName: players.name,
            skill: players.skill,
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
  const gameCount = gameList.length;
  const goalRows =
    gameList.length > 0
      ? await db
          .select({
            id: goals.id,
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
  // Escalação real de cada jogo — é ela, e não o colete da pelada, que diz
  // quem entrou em campo por qual lado.
  const lineupRows =
    gameList.length > 0
      ? await db
          .select({
            gameId: gamePlayers.gameId,
            playerId: gamePlayers.playerId,
            side: gamePlayers.side,
            playerName: players.name,
          })
          .from(gamePlayers)
          .innerJoin(players, eq(gamePlayers.playerId, players.id))
          .where(
            inArray(
              gamePlayers.gameId,
              gameList.map((g) => g.id),
            ),
          )
          .orderBy(asc(players.name))
      : [];
  const teamNameById = new Map(teamList.map((t) => [t.id, t.name]));
  const votacao = await getVotacaoDaPelada(id);
  const faltamVotar = votacao?.status === "open" ? await getFaltamVotar(votacao.id) : [];

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

      {errorMessage && (
        <p className="rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {errorMessage}
        </p>
      )}

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
        <BuscaJogador
          itens={activePlayers.map((player): ItemJogador => {
            const status = statusByPlayer.get(player.id);
            return {
              id: player.id,
              nome: player.name,
              apelido: player.nickname,
              selos: (
                <>
                  {status === "in" && (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
                      vai
                    </span>
                  )}
                  {status === "out" && (
                    <span className="rounded-full bg-neutral-200 px-2 py-0.5 text-xs font-medium text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300">
                      fora
                    </span>
                  )}
                </>
              ),
              acoes: (
                <>
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
                </>
              ),
            };
          })}
        />
      </section>

      <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="mb-3 font-bold">Times</h2>
        {matchDay.status !== "finished" && (
          <form
            action={drawTeamsAction.bind(null, matchDay.id)}
            className="mb-4 flex flex-wrap items-end gap-3"
          >
            <label className="flex flex-col gap-1 text-sm">
              Nº de times
              <select name="teamCount" defaultValue={confirmed.length >= 15 ? 3 : 2} className={inputClass}>
                <option value={2}>2</option>
                <option value={3}>3</option>
                <option value={4}>4</option>
              </select>
            </label>
            <button
              type="submit"
              className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800"
            >
              {teamList.length > 0 ? "Re-sortear" : "Sortear times"}
            </button>
            <span className="text-xs text-neutral-500">
              {confirmed.length} confirmados
              {teamList.length > 0 && gameCount > 0 && " · apague os jogos antes de re-sortear"}
            </span>
          </form>
        )}

        {teamList.length === 0 && (
          <p className="text-sm text-neutral-500">Times ainda não sorteados.</p>
        )}

        {teamList.length > 0 && (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {teamList.map((team) => {
                const members = teamMembers.filter((m) => m.teamId === team.id);
                // Soma em centésimos: acumular a nota decimal em ponto
                // flutuante mostraria "Σ 34,400000000000006".
                const skillSum =
                  members.reduce((acc, m) => acc + Math.round(m.skill * 100), 0) / 100;
                return (
                  <div
                    key={team.id}
                    className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800"
                  >
                    <div className="mb-2 flex items-center gap-2">
                      <span
                        className={`inline-block rounded-full px-3 py-1 text-sm font-bold ${vestClass(team.name)}`}
                      >
                        {team.name}
                      </span>
                      <span className="text-xs text-neutral-500">
                        Σ {formatSkill(skillSum)} · média{" "}
                        {formatSkill(skillSum / Math.max(members.length, 1))}
                      </span>
                    </div>
                    <ul className="flex flex-col gap-1 text-sm">
                      {members.map((m) => (
                        <li key={m.playerId} className="flex gap-2">
                          <span>
                            {m.isGoalkeeper ? "🧤 " : ""}
                            {m.playerName}
                          </span>
                          <span className="ml-auto text-neutral-400">{formatSkill(m.skill)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>

            {matchDay.status !== "finished" && (
              <form
                action={swapPlayersAction.bind(null, matchDay.id)}
                className="mt-4 flex flex-wrap items-end gap-3 border-t border-neutral-200 pt-4 dark:border-neutral-800"
              >
                <span className="w-full text-sm font-medium">Trocar jogadores de time</span>
                {(["playerA", "playerB"] as const).map((field) => (
                  <select key={field} name={field} className={inputClass}>
                    {teamList.map((team) => (
                      <optgroup key={team.id} label={team.name}>
                        {teamMembers
                          .filter((m) => m.teamId === team.id)
                          .map((m) => (
                            <option key={m.playerId} value={m.playerId}>
                              {m.playerName}
                            </option>
                          ))}
                      </optgroup>
                    ))}
                  </select>
                ))}
                <button
                  type="submit"
                  className="rounded-lg border border-emerald-700 px-4 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-neutral-800"
                >
                  Trocar
                </button>
              </form>
            )}
          </>
        )}
      </section>

      {teamList.length > 0 && (
        <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <h2 className="mb-3 font-bold">Jogos</h2>

          {gameList.map((game, i) => {
            const gameGoals = goalRows.filter((g) => g.gameId === game.id);
            const lineup = lineupRows.filter((m) => m.gameId === game.id);
            return (
              <div
                key={game.id}
                className="mb-3 rounded-xl border border-neutral-200 p-3 dark:border-neutral-800"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-neutral-400">Jogo {i + 1}</span>
                  <span className="font-medium">
                    {teamNameById.get(game.teamAId)} × {teamNameById.get(game.teamBId)}
                  </span>
                  {matchDay.status !== "finished" && (
                    <form action={deleteGame.bind(null, matchDay.id, game.id)} className="ml-auto">
                      <button type="submit" className="text-xs text-red-600 hover:underline">
                        excluir jogo
                      </button>
                    </form>
                  )}
                </div>

                <form
                  action={updateGameScore.bind(null, matchDay.id, game.id)}
                  className="mt-2 flex items-center gap-2"
                >
                  <input
                    name="scoreA"
                    type="number"
                    min={0}
                    defaultValue={game.scoreA}
                    className={`${inputClass} w-16 text-center`}
                  />
                  <span className="text-neutral-400">×</span>
                  <input
                    name="scoreB"
                    type="number"
                    min={0}
                    defaultValue={game.scoreB}
                    className={`${inputClass} w-16 text-center`}
                  />
                  {podeEditarPlacar && (
                    <button
                      type="submit"
                      className="rounded-lg border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
                    >
                      Salvar placar
                    </button>
                  )}
                </form>

                <div className="mt-2 flex flex-col gap-1">
                  {gameGoals.map((goal) => (
                    <div key={goal.id} className="flex items-center gap-2 text-sm">
                      <span>
                        ⚽ {goal.playerName}
                        {goal.quantity > 1 ? ` ×${goal.quantity}` : ""}
                      </span>
                      {podeEditarPlacar && (
                        <form action={deleteGoal.bind(null, matchDay.id, goal.id)}>
                          <button type="submit" className="text-xs text-red-600 hover:underline">
                            remover
                          </button>
                        </form>
                      )}
                    </div>
                  ))}
                  {podeEditarPlacar && (
                    <form
                      action={addGoal.bind(null, matchDay.id, game.id)}
                      className="mt-1 flex flex-wrap items-center gap-2"
                    >
                      <select name="playerId" className={inputClass}>
                        {(["A", "B"] as const).map((side) => (
                          <optgroup
                            key={side}
                            label={teamNameById.get(side === "A" ? game.teamAId : game.teamBId)}
                          >
                            {lineup
                              .filter((m) => m.side === side)
                              .map((m) => (
                                <option key={m.playerId} value={m.playerId}>
                                  {m.playerName}
                                </option>
                              ))}
                          </optgroup>
                        ))}
                      </select>
                      <input
                        name="quantity"
                        type="number"
                        min={1}
                        max={20}
                        defaultValue={1}
                        className={`${inputClass} w-16 text-center`}
                      />
                      <button
                        type="submit"
                        className="rounded-lg border border-emerald-700 px-3 py-1 text-sm font-medium text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-neutral-800"
                      >
                        + Gol
                      </button>
                    </form>
                  )}
                </div>
              </div>
            );
          })}

          {matchDay.status !== "finished" && teamList.length >= 2 && (
            <form
              action={createGame.bind(null, matchDay.id)}
              className="flex flex-wrap items-end gap-2 border-t border-neutral-200 pt-3 dark:border-neutral-800"
            >
              <span className="w-full text-sm font-medium">Novo jogo</span>
              <select name="teamAId" className={inputClass}>
                {teamList.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <input
                name="scoreA"
                type="number"
                min={0}
                defaultValue={0}
                className={`${inputClass} w-16 text-center`}
              />
              <span className="text-neutral-400">×</span>
              <input
                name="scoreB"
                type="number"
                min={0}
                defaultValue={0}
                className={`${inputClass} w-16 text-center`}
              />
              <select name="teamBId" defaultValue={teamList[1]?.id} className={inputClass}>
                {teamList.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800"
              >
                Adicionar
              </button>
            </form>
          )}
        </section>
      )}

      <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        {matchDay.status === "finished" ? (
          <>
            <p className="text-sm text-neutral-500">
              Pelada encerrada — os resultados contam na artilharia, nos rankings e na presença, e a
              escalação está travada.
            </p>
            <p className="mt-2 text-sm">
              {dentroDaJanela ? (
                <span className="text-amber-700 dark:text-amber-400">
                  Placar e gols ainda podem ser corrigidos por mais {horasRestantes}.
                </span>
              ) : (
                <span className="text-neutral-500">
                  A janela de 24h para corrigir placar e gols já passou. Só é possível alterar esta
                  pelada excluindo ela, o que exige votação dos jogadores.
                </span>
              )}
            </p>
          </>
        ) : (
          <>
            <p className="mb-2 text-sm text-neutral-500">
              Encerrar passa pela conferência da escalação. Depois disso ela não muda mais, e a
              rodada de avaliação abre para quem jogou.
            </p>
            <Link
              href={`/admin/peladas/${matchDay.id}/encerrar`}
              className="inline-block rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800"
            >
              Conferir escalação e encerrar
            </Link>
          </>
        )}
      </section>

      <section className="rounded-xl border border-red-200 bg-white p-4 dark:border-red-900 dark:bg-neutral-900">
        <h2 className="mb-2 font-bold text-red-700 dark:text-red-400">Excluir esta pelada</h2>

        {matchDay.status !== "finished" ? (
          <form action={deleteMatchDay.bind(null, matchDay.id)}>
            <p className="mb-2 text-sm text-neutral-500">
              Apaga presenças, times e resultados. Como a pelada não foi encerrada, nada dela conta
              em ranking ou avaliação — dá para excluir direto.
            </p>
            <button type="submit" className="text-sm text-red-600 hover:underline">
              Excluir agora
            </button>
          </form>
        ) : votacao ? (
          <div className="flex flex-col gap-2 text-sm">
            <p>
              <strong>Votação {" "}
                {votacao.status === "open"
                  ? "em andamento"
                  : votacao.status === "approved"
                    ? "aprovada"
                    : "rejeitada"}
              </strong>{" "}
              — “{votacao.reason}”
            </p>
            <p className="text-neutral-500">
              {votacao.sim} a favor · {votacao.nao} contra · precisa de {votacao.requiredYes} de{" "}
              {votacao.eligibleCount}
              {votacao.status === "open" && ` · ${votacao.horasRestantes}h restantes`}
            </p>
            {votacao.status === "open" && faltamVotar.length > 0 && (
              <p className="text-neutral-500">Faltam votar: {faltamVotar.join(", ")}</p>
            )}
            {votacao.status === "rejected" && (
              <p className="text-neutral-500">
                O grupo decidiu manter. Uma pelada só pode ter uma votação, então ela fica no
                histórico definitivamente.
              </p>
            )}
          </div>
        ) : (
          <form action={abrirVotacaoExclusao.bind(null, matchDay.id)} className="flex flex-col gap-2">
            <p className="text-sm text-neutral-500">
              A pelada já foi encerrada: os gols, o V/E/D e as avaliações dela contam para todo
              mundo. Apagar exige a aprovação de quem jogou — 85% dos votos em 48h, e quem não votar
              conta como contra. <strong>Só existe uma votação por pelada.</strong>
            </p>
            <input
              name="reason"
              required
              minLength={10}
              maxLength={500}
              placeholder="Por que esta pelada precisa ser apagada?"
              className={inputClass}
            />
            <button
              type="submit"
              className="self-start rounded-lg border border-red-300 px-4 py-2 text-sm text-red-600 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950"
            >
              Abrir votação de exclusão
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
