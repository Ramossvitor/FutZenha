import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { games, matchDays, teams } from "@/db/schema";
import { formatDate, formatDateShort, formatTime } from "@/lib/format";
import { papelLabel, podeEntrarNoGrupo, podeVerGrupo } from "@/lib/grupos-permissions";
import { getGrupo, listarMembros, papelNoGrupo, temPedidoPendente } from "@/lib/grupos";
import { podeGerenciarPelada } from "@/lib/permissions";
import { getSession } from "@/lib/session";
import { cancelarPedido, entrarNoGrupo, pedirEntrada, sairDoGrupo } from "./actions";

export const dynamic = "force-dynamic";


const errorMessages: Record<string, string> = {
  "entrada-fechada": "Este grupo não está aceitando entradas agora.",
  "admin-precisa-transferir":
    "Você administra o grupo. Transfira a administração para outra pessoa antes de sair.",
};

const okMessages: Record<string, string> = {
  entrou: "Pronto, você está no grupo.",
  "pedido-enviado": "Pedido enviado. O administrador vai decidir.",
  "pedido-cancelado": "Pedido cancelado.",
};

/**
 * O título repete a checagem de visibilidade, e não é redundância.
 *
 * `generateMetadata` roda **antes** do corpo da página e não é abortado pelo
 * `notFound()` de lá: sem este teste, o grupo privado respondia 404 com
 * `<title>Grupo Secreto — FutZenha</title>` no HTML. O status escondia a
 * página; o título entregava o nome de todo grupo privado da plataforma para
 * quem varresse os ids.
 */
export async function generateMetadata({ params }: PageProps<"/grupo/[id]">) {
  const generico = { title: "Grupo" };
  const { id } = await params;
  const groupId = Number(id);
  if (!Number.isInteger(groupId)) return generico;

  const grupo = await getGrupo(groupId);
  if (!grupo) return generico;

  // Grupo público tem nome público — inclusive para quem não está logado, que é
  // o caso do link compartilhado.
  if (grupo.visibility === "public") return { title: grupo.name };

  const session = await getSession();
  if (!session) return generico;
  const papel = await papelNoGrupo(groupId, session.player.id);
  const ator = { playerId: session.player.id, isPlatformAdmin: session.isPlatformAdmin };
  return podeVerGrupo(ator, grupo, papel) ? { title: grupo.name } : generico;
}

/**
 * A página do grupo — a única rota de grupo que atende quem não é membro, e por
 * isso a única sem guard `require*`.
 *
 * A checagem de visibilidade é feita na mão logo abaixo. Um esquecimento aqui
 * não dá erro nenhum: só entrega a lista de membros de todo grupo privado da
 * plataforma para quem souber somar 1 no id.
 */
export default async function GrupoPage({ params, searchParams }: PageProps<"/grupo/[id]">) {
  const { id } = await params;
  const groupId = Number(id);
  if (!Number.isInteger(groupId)) notFound();

  const { erro, ok } = await searchParams;
  const mensagemErro = typeof erro === "string" ? errorMessages[erro] : undefined;
  const mensagemOk = typeof ok === "string" ? okMessages[ok] : undefined;

  const grupo = await getGrupo(groupId);
  if (!grupo) notFound();

  const session = await getSession();
  const ator = session
    ? { playerId: session.player.id, isPlatformAdmin: session.isPlatformAdmin }
    : null;
  const papel = session ? await papelNoGrupo(groupId, session.player.id) : null;

  // Deslogado só enxerga grupo público; quem está de fora de um privado leva o
  // mesmo 404 de id inexistente.
  if (!ator) {
    if (grupo.visibility !== "public") notFound();
  } else if (!podeVerGrupo(ator, grupo, papel)) {
    notFound();
  }

  const [membros, days, pedido] = await Promise.all([
    listarMembros(groupId),
    db
      .select()
      .from(matchDays)
      .where(eq(matchDays.groupId, groupId))
      .orderBy(desc(matchDays.date), desc(matchDays.id)),
    session && papel === null ? temPedidoPendente(groupId, session.player.id) : Promise.resolve(false),
  ]);

  const dayIds = days.map((d) => d.id);
  const gameRows = dayIds.length
    ? await db
        .select()
        .from(games)
        .where(inArray(games.matchDayId, dayIds))
        .orderBy(asc(games.sortOrder), asc(games.id))
    : [];
  const teamRows = dayIds.length
    ? await db.select().from(teams).where(inArray(teams.matchDayId, dayIds))
    : [];
  const teamNameById = new Map(teamRows.map((t) => [t.id, t.name]));

  const entrada = session ? podeEntrarNoGrupo(grupo, papel) : "so-convite";
  const podeCriarPelada = papel === "admin" || papel === "organizer";
  // O organizador também chega em /gerenciar — é de lá que ele gera o link e
  // convida, que é metade do papel dele.
  const podeGerenciar = podeCriarPelada || session?.isPlatformAdmin === true;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold">{grupo.name}</h1>
          {papel && (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
              {papelLabel[papel]}
            </span>
          )}
          {grupo.visibility === "private" && (
            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
              privado
            </span>
          )}
        </div>
        {grupo.description && <p className="text-sm text-neutral-500">{grupo.description}</p>}

        <div className="flex flex-wrap items-center gap-2">
          {papel && (
            <Link
              href={`/grupo/${groupId}/ranking`}
              className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
            >
              Ranking do grupo
            </Link>
          )}
          {podeCriarPelada && (
            <Link
              href={`/peladas/nova?grupo=${groupId}`}
              className="rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800"
            >
              Marcar pelada
            </Link>
          )}
          {podeGerenciar && (
            <Link
              href={`/grupo/${groupId}/gerenciar`}
              className="rounded-lg border border-amber-400 px-3 py-1.5 text-sm text-amber-800 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-950"
            >
              Gerenciar
            </Link>
          )}
          {session && entrada === "entra-direto" && (
            <form action={entrarNoGrupo.bind(null, groupId)}>
              <button
                type="submit"
                className="rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800"
              >
                Entrar no grupo
              </button>
            </form>
          )}
          {session && entrada === "pede-entrada" && !pedido && (
            <form action={pedirEntrada.bind(null, groupId)}>
              <button
                type="submit"
                className="rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800"
              >
                Pedir para entrar
              </button>
            </form>
          )}
          {session && entrada === "pede-entrada" && pedido && (
            <form action={cancelarPedido.bind(null, groupId)} className="flex items-center gap-2">
              <span className="text-sm text-neutral-500">Pedido aguardando aprovação.</span>
              <button type="submit" className="text-sm text-neutral-500 hover:underline">
                Cancelar
              </button>
            </form>
          )}
          {papel && papel !== "admin" && (
            <form action={sairDoGrupo.bind(null, groupId)} className="ml-auto">
              <button type="submit" className="text-sm text-neutral-500 hover:underline">
                Sair do grupo
              </button>
            </form>
          )}
        </div>
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
        <h2 className="text-lg font-bold">Peladas do grupo</h2>
        {days.length === 0 && <p className="text-neutral-500">Nenhuma pelada marcada ainda.</p>}
        {days.map((day) => {
          const dayGames = gameRows.filter((g) => g.matchDayId === day.id);
          const euGerencio = ator !== null && podeGerenciarPelada(ator, day, papel);
          return (
            <Link
              key={day.id}
              href={`/pelada/${day.id}`}
              className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm hover:border-emerald-600 dark:border-neutral-800 dark:bg-neutral-900"
            >
              <div className="flex items-center gap-2">
                <span className="font-bold capitalize">{formatDate(day.date)}</span>
                <span className="text-sm text-neutral-500">{formatDateShort(day.date)}</span>
                {euGerencio && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900 dark:text-amber-200">
                    você gerencia
                  </span>
                )}
                {day.status !== "finished" && (
                  <span className="ml-auto rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
                    {day.status === "scheduled" ? "marcada" : "times sorteados"}
                  </span>
                )}
              </div>
              <p className="text-sm text-neutral-500">
                {formatTime(day.startTime) && <>{formatTime(day.startTime)} · </>}
                {day.location}
              </p>
              {dayGames.length > 0 && (
                <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
                  {dayGames
                    .map(
                      (g) =>
                        `${teamNameById.get(g.teamAId)} ${g.scoreA}×${g.scoreB} ${teamNameById.get(g.teamBId)}`,
                    )
                    .join(" · ")}
                </p>
              )}
            </Link>
          );
        })}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-bold">
          Membros <span className="text-sm font-normal text-neutral-500">({membros.length})</span>
        </h2>
        <ul className="flex flex-col gap-1">
          {membros.map((m) => (
            <li
              key={m.playerId}
              className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm dark:border-neutral-800 dark:bg-neutral-900"
            >
              <span className="font-medium">{m.name}</span>
              {m.nickname && <span className="text-neutral-500">“{m.nickname}”</span>}
              {m.papel !== "member" && (
                <span className="ml-auto rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
                  {papelLabel[m.papel]}
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
