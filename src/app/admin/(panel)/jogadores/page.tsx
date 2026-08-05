import { asc, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { invites, players, users, type Invite, type Player, type User } from "@/db/schema";
import { formatSkill } from "@/lib/format";
import { siteUrl } from "@/lib/site-url";
import {
  createInvite,
  createPlayer,
  revokeInvite,
  setPlayerActive,
  setUserActive,
  updatePlayer,
} from "./actions";
import { CopyButton } from "./copy-button";

const inputClass =
  "rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-emerald-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100";

const errorMessages: Record<string, string> = {
  "nome-duplicado": "Já existe um jogador com esse nome.",
  "dados-invalidos": "Dados inválidos — confira o nome.",
};

function PlayerFields({ player }: { player?: Player }) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-sm">
        Nome
        <input name="name" required defaultValue={player?.name} className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Apelido
        <input name="nickname" defaultValue={player?.nickname ?? ""} className={inputClass} />
      </label>
      <label className="flex items-center gap-2 py-2 text-sm">
        <input
          name="isGoalkeeper"
          type="checkbox"
          defaultChecked={player?.isGoalkeeper}
          className="size-4 accent-emerald-700"
        />
        Goleiro
      </label>
      <button
        type="submit"
        className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800"
      >
        {player ? "Salvar" : "Adicionar"}
      </button>
    </div>
  );
}

const badgeClass = "rounded-full px-2 py-0.5 text-xs font-medium";

// Bloco "Acesso" de um jogador ativo: estado da conta + ciclo de vida do
// convite. Um convite pendente para quem já tem conta é um reset de senha.
// A expiração vem calculada do banco (now() do Postgres) — regra de pureza
// do React proíbe Date.now() durante o render.
function AccessSection({
  player,
  user,
  pending,
}: {
  player: Player;
  user?: User;
  pending?: { invite: Invite; expired: boolean };
}) {
  const invite = pending?.invite;
  const inviteUrl = invite ? `${siteUrl()}/convite/${invite.token}` : null;
  const invitePending = pending != null && !pending.expired;
  const inviteExpired = pending != null && pending.expired;

  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-neutral-200 pt-3 text-sm dark:border-neutral-800">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">Acesso</span>
        {!user && (
          <span className={`${badgeClass} bg-neutral-200 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400`}>
            sem conta
          </span>
        )}
        {user && user.active && (
          <span className={`${badgeClass} bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200`}>
            @{user.username}
          </span>
        )}
        {user && !user.active && (
          <span className={`${badgeClass} bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300`}>
            conta desativada (@{user.username})
          </span>
        )}
        {inviteExpired && (
          <span className={`${badgeClass} bg-neutral-200 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400`}>
            convite expirado
          </span>
        )}
      </div>

      {invitePending && invite && inviteUrl && (
        <div className="flex flex-wrap items-center gap-2">
          <span className={`${badgeClass} bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200`}>
            convite pendente
          </span>
          <code className="max-w-full break-all rounded bg-neutral-100 px-2 py-1 text-xs dark:bg-neutral-800">
            {inviteUrl}
          </code>
          <CopyButton text={inviteUrl} />
          <span className="text-xs text-neutral-500">
            expira {invite.expiresAt.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
          </span>
          <form action={revokeInvite.bind(null, player.id)}>
            <button type="submit" className="text-sm text-red-600 hover:underline">
              Revogar convite
            </button>
          </form>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-4">
        {!invitePending && (
          <form action={createInvite.bind(null, player.id)}>
            <button type="submit" className="text-sm text-emerald-700 hover:underline">
              {user ? "Resetar senha (novo convite)" : inviteExpired ? "Gerar novo convite" : "Gerar convite"}
            </button>
          </form>
        )}
        {user && (
          <form action={setUserActive.bind(null, user.id, !user.active)}>
            <button
              type="submit"
              className={`text-sm hover:underline ${user.active ? "text-red-600" : "text-emerald-700"}`}
            >
              {user.active ? "Desativar conta" : "Reativar conta"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default async function JogadoresPage({ searchParams }: PageProps<"/admin/jogadores">) {
  const { erro } = await searchParams;
  const [allPlayers, allUsers, pendingInvites] = await Promise.all([
    db.select().from(players).orderBy(asc(players.name)),
    db.select().from(users),
    db
      .select({ invite: invites, expired: sql<boolean>`${invites.expiresAt} <= now()` })
      .from(invites)
      .where(isNull(invites.usedAt)),
  ]);
  const userByPlayer = new Map(allUsers.map((u) => [u.playerId, u]));
  const inviteByPlayer = new Map(pendingInvites.map((r) => [r.invite.playerId, r]));
  const active = allPlayers.filter((p) => p.active);
  const inactive = allPlayers.filter((p) => !p.active);
  const errorMessage = typeof erro === "string" ? errorMessages[erro] : undefined;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Jogadores</h1>

      {errorMessage && (
        <p className="rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {errorMessage}
        </p>
      )}

      <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="mb-3 font-bold">Novo jogador</h2>
        <form action={createPlayer}>
          <PlayerFields />
        </form>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-bold">
          Elenco <span className="text-sm font-normal text-neutral-500">({active.length})</span>
        </h2>
        {active.length === 0 && (
          <p className="text-sm text-neutral-500">Nenhum jogador cadastrado ainda.</p>
        )}
        {active.map((player) => (
          <details
            key={player.id}
            className="rounded-xl border border-neutral-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-900"
          >
            <summary className="flex cursor-pointer items-center gap-2 px-4 py-3">
              <span className="font-medium">{player.name}</span>
              {player.nickname && (
                <span className="text-sm text-neutral-500">“{player.nickname}”</span>
              )}
              {player.isGoalkeeper && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900 dark:text-amber-200">
                  🧤 goleiro
                </span>
              )}
              <span className="ml-auto rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
                nota {formatSkill(player.skill)}
              </span>
            </summary>
            <div className="border-t border-neutral-200 px-4 py-3 dark:border-neutral-800">
              <form action={updatePlayer.bind(null, player.id)}>
                <PlayerFields player={player} />
              </form>
              <form action={setPlayerActive.bind(null, player.id, false)} className="mt-2">
                <button type="submit" className="text-sm text-red-600 hover:underline">
                  Desativar (sai das listas, mantém histórico)
                </button>
              </form>
              <AccessSection
                player={player}
                user={userByPlayer.get(player.id)}
                pending={inviteByPlayer.get(player.id)}
              />
            </div>
          </details>
        ))}
      </section>

      {inactive.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="font-bold text-neutral-500">Inativos ({inactive.length})</h2>
          {inactive.map((player) => (
            <div
              key={player.id}
              className="flex items-center gap-2 rounded-xl border border-neutral-200 bg-neutral-100 px-4 py-3 text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900"
            >
              <span>{player.name}</span>
              <form action={setPlayerActive.bind(null, player.id, true)} className="ml-auto">
                <button type="submit" className="text-sm text-emerald-700 hover:underline">
                  Reativar
                </button>
              </form>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
