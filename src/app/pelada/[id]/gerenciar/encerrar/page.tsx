import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { gamePlayers, games, players, teams, users } from "@/db/schema";
import { formatDate } from "@/lib/format";
import { requirePeladaAdmin } from "@/lib/require-pelada-admin";
import { vestClass } from "@/lib/team-colors";
import { BuscaJogador, type ItemJogador } from "../busca-jogador";
import { confirmarEncerramento, incluirNoJogo, moverLado, removerDoJogo } from "./actions";

export const metadata = { title: "Conferir escalação" };

const errorMessages: Record<string, string> = {
  "jogo-sem-time": "Todo jogo precisa de pelo menos um jogador de cada lado.",
  "precisa-confirmar":
    "Quem tem conta ativa e ainda não entrou nesta pelada precisa marcar a própria presença antes de ser escalado.",
};

const acaoClass =
  "rounded-lg border border-neutral-300 px-2 py-0.5 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800";

const seloSemAcesso = (
  <span className="rounded-full bg-neutral-200 px-2 py-0.5 text-xs font-medium text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200">
    sem acesso
  </span>
);

export default async function EncerrarPeladaPage({
  params,
  searchParams,
}: PageProps<"/pelada/[id]/gerenciar/encerrar">) {
  const { id: idParam } = await params;
  const { erro } = await searchParams;
  const id = Number(idParam);
  if (!Number.isInteger(id)) notFound();

  const { matchDay } = await requirePeladaAdmin(id);
  // Encerrada já não tem o que conferir — a escalação virou imutável.
  if (matchDay.status === "finished") redirect(`/pelada/${id}/gerenciar`);

  const [gameList, teamList, elenco] = await Promise.all([
    db
      .select()
      .from(games)
      .where(eq(games.matchDayId, id))
      .orderBy(asc(games.sortOrder), asc(games.id)),
    db.select().from(teams).where(eq(teams.matchDayId, id)).orderBy(asc(teams.sortOrder)),
    db
      .select({
        id: players.id,
        name: players.name,
        nickname: players.nickname,
        isGoalkeeper: players.isGoalkeeper,
        userId: users.id,
      })
      .from(players)
      .leftJoin(users, eq(users.playerId, players.id))
      .where(eq(players.active, true))
      .orderBy(asc(players.name)),
  ]);

  const escalacao =
    gameList.length > 0
      ? await db
          .select({
            gameId: gamePlayers.gameId,
            playerId: gamePlayers.playerId,
            side: gamePlayers.side,
          })
          .from(gamePlayers)
          .where(
            inArray(
              gamePlayers.gameId,
              gameList.map((g) => g.id),
            ),
          )
      : [];

  const jogadorPorId = new Map(elenco.map((p) => [p.id, p]));
  const teamNameById = new Map(teamList.map((t) => [t.id, t.name]));
  const errorMessage = typeof erro === "string" ? errorMessages[erro] : undefined;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold capitalize">Conferir escalação — {formatDate(matchDay.date)}</h1>
        <Link
          href={`/pelada/${id}/gerenciar`}
          className="ml-auto text-sm font-medium text-emerald-700 hover:underline dark:text-emerald-400"
        >
          ← Voltar
        </Link>
      </header>

      <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
        Confira quem jogou em cada time. <strong>Depois de encerrar, a escalação não pode mais
        ser alterada</strong> — é ela que define quem avalia quem. Placar e gols ainda poderão ser
        corrigidos por 24h. Corrigir uma escalação errada depois disso só excluindo a pelada, o que
        exige votação dos jogadores.
      </p>

      {errorMessage && (
        <p className="rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {errorMessage}
        </p>
      )}

      {gameList.length === 0 && (
        <p className="rounded-xl border border-neutral-200 bg-white p-4 text-sm text-neutral-500 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          Nenhum jogo lançado nesta pelada. Encerrar sem jogos é possível, mas não haverá
          avaliação — não há escalação para dizer quem jogou com quem.
        </p>
      )}

      {gameList.map((game, i) => {
        const doJogo = escalacao.filter((e) => e.gameId === game.id);
        const fora = elenco.filter((p) => !doJogo.some((e) => e.playerId === p.id));

        const lado = (side: "A" | "B") =>
          doJogo
            .filter((e) => e.side === side)
            .map((e) => jogadorPorId.get(e.playerId))
            .filter((p) => p !== undefined)
            .sort((a, b) => a.name.localeCompare(b.name));

        return (
          <section
            key={game.id}
            className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900"
          >
            <h2 className="mb-3 flex flex-wrap items-center gap-2 font-bold">
              <span className="text-xs font-normal text-neutral-400">Jogo {i + 1}</span>
              <span className={`inline-block rounded-full px-3 py-1 text-sm ${vestClass(teamNameById.get(game.teamAId) ?? "")}`}>
                {teamNameById.get(game.teamAId)}
              </span>
              <span className="text-neutral-400">
                {game.scoreA} × {game.scoreB}
              </span>
              <span className={`inline-block rounded-full px-3 py-1 text-sm ${vestClass(teamNameById.get(game.teamBId) ?? "")}`}>
                {teamNameById.get(game.teamBId)}
              </span>
            </h2>

            <div className="grid gap-4 sm:grid-cols-2">
              {(["A", "B"] as const).map((side) => {
                const membros = lado(side);
                return (
                  <div key={side}>
                    <h3 className="mb-1 text-sm font-medium text-neutral-500">
                      {teamNameById.get(side === "A" ? game.teamAId : game.teamBId)} ({membros.length})
                    </h3>
                    {membros.length === 0 && (
                      <p className="text-sm text-red-600">Nenhum jogador deste lado.</p>
                    )}
                    <ul className="flex flex-col gap-1 text-sm">
                      {membros.map((p) => (
                        <li key={p.id} className="flex items-center gap-2">
                          <span>
                            {p.isGoalkeeper ? "🧤 " : ""}
                            {p.name}
                          </span>
                          {!p.userId && seloSemAcesso}
                          <span className="ml-auto flex gap-1">
                            <form action={moverLado.bind(null, id, game.id, p.id)}>
                              <button type="submit" className={acaoClass} title="Trocar de time">
                                {side === "A" ? "→" : "←"}
                              </button>
                            </form>
                            <form action={removerDoJogo.bind(null, id, game.id, p.id)}>
                              <button
                                type="submit"
                                className="rounded-lg border border-red-300 px-2 py-0.5 text-xs text-red-600 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950"
                                title="Não jogou esta partida"
                              >
                                ×
                              </button>
                            </form>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>

            <details className="mt-3 border-t border-neutral-200 pt-3 dark:border-neutral-800">
              <summary className="cursor-pointer text-sm font-medium text-emerald-700 dark:text-emerald-400">
                Incluir alguém neste jogo ({fora.length} fora)
              </summary>
              <p className="mt-2 mb-2 text-xs text-neutral-500">
                Escalar aqui marca a presença do jogador na pelada automaticamente.
              </p>
              <BuscaJogador
                vazio="Todo o elenco já está escalado neste jogo."
                itens={fora.map(
                  (p): ItemJogador => ({
                    id: p.id,
                    nome: p.name,
                    apelido: p.nickname,
                    selos: p.userId ? undefined : seloSemAcesso,
                    acoes: (
                      <>
                        {(["A", "B"] as const).map((side) => (
                          <form key={side} action={incluirNoJogo.bind(null, id, game.id, side, p.id)}>
                            <button type="submit" className={acaoClass}>
                              + {teamNameById.get(side === "A" ? game.teamAId : game.teamBId)}
                            </button>
                          </form>
                        ))}
                      </>
                    ),
                  }),
                )}
              />
            </details>
          </section>
        );
      })}

      <section className="rounded-xl border border-emerald-300 bg-white p-4 shadow-sm dark:border-emerald-800 dark:bg-neutral-900">
        <form action={confirmarEncerramento.bind(null, id)}>
          <p className="mb-3 text-sm text-neutral-600 dark:text-neutral-300">
            Encerrar trava a escalação, faz os resultados contarem na artilharia, nos rankings e na
            presença, e abre a rodada de avaliação para quem jogou.
          </p>
          <button
            type="submit"
            className="rounded-lg bg-emerald-700 px-4 py-2 font-medium text-white hover:bg-emerald-800"
          >
            Confirmar escalação e encerrar
          </button>
        </form>
      </section>
    </div>
  );
}
