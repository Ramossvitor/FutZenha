import type { Metadata } from "next";
import Link from "next/link";
import { formatDateShort } from "@/lib/format";
import { listarNotificacoes } from "@/lib/notifications";
import { requirePlayer } from "@/lib/require-player";
import { marcarComoLida, marcarTodasComoLidas } from "./actions";

export const metadata: Metadata = { title: "Notificações" };

export default async function NotificacoesPage() {
  const session = await requirePlayer();
  const notificacoes = await listarNotificacoes(session.player.id);
  const naoLidas = notificacoes.filter((n) => n.readAt === null).length;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold">Notificações</h1>
        {naoLidas > 0 && (
          <form action={marcarTodasComoLidas} className="ml-auto">
            <button type="submit" className="text-sm text-emerald-700 hover:underline dark:text-emerald-400">
              Marcar todas como lidas
            </button>
          </form>
        )}
      </header>

      {notificacoes.length === 0 ? (
        <p className="rounded-xl border border-neutral-200 bg-white p-4 text-sm text-neutral-500 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          Nada por aqui ainda.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {notificacoes.map((n) => {
            const conteudo = (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  {n.readAt === null && (
                    <span className="size-2 shrink-0 rounded-full bg-emerald-600" aria-hidden />
                  )}
                  <span className="font-medium">{n.title}</span>
                  <span className="ml-auto text-xs text-neutral-400">
                    {formatDateShort(n.createdAt.toISOString().slice(0, 10))}
                  </span>
                </div>
                {n.body && <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">{n.body}</p>}
              </>
            );

            return (
              <li
                key={n.id}
                className={`rounded-xl border p-4 shadow-sm ${
                  n.readAt === null
                    ? "border-emerald-300 bg-white dark:border-emerald-800 dark:bg-neutral-900"
                    : "border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
                }`}
              >
                {n.href ? (
                  <Link href={n.href} className="block hover:underline">
                    {conteudo}
                  </Link>
                ) : (
                  conteudo
                )}
                {n.readAt === null && (
                  <form action={marcarComoLida.bind(null, n.id)} className="mt-2">
                    <button type="submit" className="text-xs text-neutral-500 hover:underline">
                      marcar como lida
                    </button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
