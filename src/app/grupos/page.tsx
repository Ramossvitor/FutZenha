import Link from "next/link";
import { convitesPendentes, listarGruposPublicos, listarMeusGrupos } from "@/lib/grupos";
import { papelLabel } from "@/lib/grupos-permissions";
import { requirePlayer } from "@/lib/require-player";
import { responderConvite } from "@/app/grupo/[id]/actions";

export const metadata = { title: "Grupos" };
export const dynamic = "force-dynamic";

const inputClass =
  "rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-emerald-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100";

const errorMessages: Record<string, string> = {
  "convite-invalido": "Esse convite não está mais disponível.",
  // Vem de src/app/convite-grupo/[token]/actions.ts. Sem esta entrada, quem
  // clicava num link vencido do WhatsApp caía aqui sem explicação nenhuma.
  "link-invalido":
    "Esse link do grupo não vale mais — ele expirou, foi revogado ou já bateu o limite de usos. Peça um novo a quem administra o grupo.",
};

const okMessages: Record<string, string> = {
  "convite-recusado": "Convite recusado.",
  saiu: "Você saiu do grupo.",
  "grupo-excluido": "Grupo excluído.",
};

export default async function GruposPage({ searchParams }: PageProps<"/grupos">) {
  const session = await requirePlayer();
  const { busca, erro, ok } = await searchParams;
  const termo = typeof busca === "string" ? busca : "";
  const mensagemErro = typeof erro === "string" ? errorMessages[erro] : undefined;
  const mensagemOk = typeof ok === "string" ? okMessages[ok] : undefined;

  const [meus, convites, publicos] = await Promise.all([
    listarMeusGrupos(session.player.id),
    convitesPendentes(session.player.id),
    listarGruposPublicos(termo),
  ]);

  // Grupo de que já participo não precisa aparecer em "descobrir".
  const meusIds = new Set(meus.map((g) => g.id));
  const paraDescobrir = publicos.filter((g) => !meusIds.has(g.id));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Grupos</h1>
        <Link
          href="/grupos/novo"
          className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800"
        >
          Criar grupo
        </Link>
      </div>

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

      {convites.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-bold">Convites para você</h2>
          {convites.map((c) => (
            <div
              key={c.id}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 shadow-sm dark:border-amber-800 dark:bg-amber-950"
            >
              <div className="flex-1">
                <p className="font-medium">{c.groupName}</p>
                <p className="text-sm text-neutral-600 dark:text-neutral-400">
                  {c.convidadoPor ? `Convite de ${c.convidadoPor}` : "Você foi convidado"}
                  {c.groupDescription && ` · ${c.groupDescription}`}
                </p>
              </div>
              <form action={responderConvite.bind(null, c.groupId, c.id, true)}>
                <button
                  type="submit"
                  className="rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800"
                >
                  Aceitar
                </button>
              </form>
              <form action={responderConvite.bind(null, c.groupId, c.id, false)}>
                <button
                  type="submit"
                  className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
                >
                  Recusar
                </button>
              </form>
            </div>
          ))}
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-bold">Meus grupos</h2>
        {meus.length === 0 && (
          <p className="text-neutral-500">
            Você ainda não está em nenhum grupo. Crie o seu ou procure um público abaixo.
          </p>
        )}
        {meus.map((g) => (
          <Link
            key={g.id}
            href={`/grupo/${g.id}`}
            className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm hover:border-emerald-600 dark:border-neutral-800 dark:bg-neutral-900"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-bold">{g.name}</span>
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
                {papelLabel[g.papel]}
              </span>
              {g.visibility === "private" && (
                <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                  privado
                </span>
              )}
              <span className="ml-auto text-sm text-neutral-500">
                {g.membros} {g.membros === 1 ? "membro" : "membros"}
              </span>
            </div>
            {g.description && (
              <p className="text-sm text-neutral-500">{g.description}</p>
            )}
          </Link>
        ))}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-bold">Descobrir grupos</h2>
        <form action="/grupos" className="flex flex-wrap gap-2">
          <input
            name="busca"
            defaultValue={termo}
            placeholder="Buscar por nome"
            className={`${inputClass} flex-1`}
          />
          <button
            type="submit"
            className="rounded-lg border border-neutral-300 px-4 py-2 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            Buscar
          </button>
        </form>
        {paraDescobrir.length === 0 && (
          <p className="text-neutral-500">
            {termo ? "Nenhum grupo público com esse nome." : "Nenhum grupo público por enquanto."}
          </p>
        )}
        {paraDescobrir.map((g) => (
          <Link
            key={g.id}
            href={`/grupo/${g.id}`}
            className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm hover:border-emerald-600 dark:border-neutral-800 dark:bg-neutral-900"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-bold">{g.name}</span>
              {g.joinPolicy === "open" && (
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
                  entrada livre
                </span>
              )}
              <span className="ml-auto text-sm text-neutral-500">
                {g.membros} {g.membros === 1 ? "membro" : "membros"}
              </span>
            </div>
            {g.description && <p className="text-sm text-neutral-500">{g.description}</p>}
          </Link>
        ))}
      </section>
    </div>
  );
}
