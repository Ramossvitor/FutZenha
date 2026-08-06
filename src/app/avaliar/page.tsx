import type { Metadata } from "next";
import Link from "next/link";
import { formatDate } from "@/lib/format";
import { getRodadasAbertasDoJogador } from "@/lib/ratings";
import { requirePlayer } from "@/lib/require-player";

export const metadata: Metadata = { title: "Avaliações" };

export default async function AvaliarPage() {
  const session = await requirePlayer();
  const rodadas = await getRodadasAbertasDoJogador(session.player.id);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Avaliações abertas</h1>

      {rodadas.length === 0 ? (
        <p className="rounded-xl border border-neutral-200 bg-white p-4 text-sm text-neutral-500 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          Nenhuma avaliação aberta agora. Depois que uma pelada que você jogou for encerrada, ela
          aparece aqui.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rodadas.map(({ round, matchDayDate, location, jaEnviou, horasRestantes }) => (
            <li key={round.id}>
              <Link
                href={`/avaliar/${round.id}`}
                className="flex flex-wrap items-center gap-2 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm hover:border-emerald-600 dark:border-neutral-800 dark:bg-neutral-900"
              >
                <div>
                  <p className="font-medium capitalize">{formatDate(matchDayDate)}</p>
                  <p className="text-sm text-neutral-500">{location}</p>
                </div>
                <div className="ml-auto flex flex-col items-end gap-1">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      jaEnviou
                        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200"
                        : "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200"
                    }`}
                  >
                    {jaEnviou ? "avaliado" : "falta avaliar"}
                  </span>
                  <span className="text-xs text-neutral-500">faltam {horasRestantes}h</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
