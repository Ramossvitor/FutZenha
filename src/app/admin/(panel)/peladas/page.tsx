import Link from "next/link";
import { countDistinct, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { gamePlayers, games, matchDays, players, ratingRounds, users } from "@/db/schema";
import { formatDate, formatDateShort, formatTime } from "@/lib/format";
import { requirePlatformAdmin } from "@/lib/require-platform-admin";
import { excluirPeladaAbusiva } from "./actions";

export const metadata = { title: "Supervisão de peladas" };

const statusLabels = {
  scheduled: "marcada",
  teams_drawn: "times sorteados",
  finished: "encerrada",
} as const;

const errorMessages: Record<string, string> = {
  "motivo-curto": "Escreva o motivo da exclusão (pelo menos 10 caracteres).",
};

const okMessages: Record<string, string> = {
  excluida: "Pelada excluída. As notas de todo mundo foram recalculadas do zero.",
};

const inputClass =
  "min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-900 outline-none focus:border-red-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100";

export default async function AdminPeladasPage({ searchParams }: PageProps<"/admin/peladas">) {
  await requirePlatformAdmin();
  const { erro, ok } = await searchParams;

  // Uma linha por pelada com o que denuncia fabricação: quem criou, quantos
  // jogaram e — o que mais importa — quantos desses tinham conta, já que é a
  // conta que move a nota.
  const peladas = await db
    .select({
      id: matchDays.id,
      date: matchDays.date,
      startTime: matchDays.startTime,
      location: matchDays.location,
      status: matchDays.status,
      criador: players.name,
      jogaram: countDistinct(gamePlayers.playerId),
      comConta: countDistinct(sql`case when ${users.active} then ${users.playerId} end`),
      temRodada: sql<boolean>`bool_or(${ratingRounds.id} is not null)`,
    })
    .from(matchDays)
    .leftJoin(players, eq(matchDays.createdByPlayerId, players.id))
    .leftJoin(games, eq(games.matchDayId, matchDays.id))
    .leftJoin(gamePlayers, eq(gamePlayers.gameId, games.id))
    .leftJoin(users, eq(users.playerId, gamePlayers.playerId))
    .leftJoin(ratingRounds, eq(ratingRounds.matchDayId, matchDays.id))
    .groupBy(matchDays.id, players.name)
    .orderBy(desc(matchDays.date), desc(matchDays.id));

  const mensagemErro = typeof erro === "string" ? errorMessages[erro] : undefined;
  const mensagemOk = typeof ok === "string" ? okMessages[ok] : undefined;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">Supervisão de peladas</h1>
        <p className="text-sm text-neutral-500">
          Todas as peladas do sistema, de quem as criou. Excluir aqui não passa pela votação do
          grupo — é para desfazer pelada fabricada.
        </p>
      </header>

      {mensagemErro && (
        <p className="rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {mensagemErro}
        </p>
      )}

      {mensagemOk && (
        <p className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
          {mensagemOk}
        </p>
      )}

      <section className="flex flex-col gap-2">
        {peladas.length === 0 && <p className="text-sm text-neutral-500">Nenhuma pelada ainda.</p>}
        {peladas.map((p) => (
          <article
            key={p.id}
            className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/pelada/${p.id}`} className="font-medium capitalize hover:underline">
                {formatDate(p.date)}
              </Link>
              <span className="text-sm text-neutral-500">{formatDateShort(p.date)}</span>
              <span className="ml-auto rounded-full bg-neutral-200 px-2 py-0.5 text-xs font-medium dark:bg-neutral-800">
                {statusLabels[p.status]}
              </span>
            </div>

            <p className="text-sm text-neutral-500">
              {formatTime(p.startTime) && <>{formatTime(p.startTime)} · </>}
              {p.location}
            </p>

            <p className="mt-1 text-sm text-neutral-500">
              Criada por <strong>{p.criador ?? "— (pelada órfã)"}</strong> · {p.jogaram} jogaram,{" "}
              <strong>{p.comConta} com conta ativa</strong>
              {p.temRodada ? " · gerou avaliação" : " · sem avaliação"}
            </p>

            <details className="mt-3">
              <summary className="cursor-pointer text-sm text-red-700 dark:text-red-400">
                Excluir por abuso
              </summary>
              <form
                action={excluirPeladaAbusiva.bind(null, p.id)}
                className="mt-2 flex flex-wrap items-center gap-2"
              >
                <input
                  name="motivo"
                  required
                  minLength={10}
                  placeholder="Motivo (fica no log do servidor)"
                  className={inputClass}
                />
                <button
                  type="submit"
                  className="rounded-lg bg-red-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-red-800"
                >
                  Excluir e recalcular
                </button>
              </form>
            </details>
          </article>
        ))}
      </section>
    </div>
  );
}
