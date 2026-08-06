import Link from "next/link";
import { contarDenunciasAbertas } from "@/lib/reports";

const cardClass =
  "rounded-xl border border-neutral-200 bg-white p-4 shadow-sm hover:border-emerald-600 dark:border-neutral-800 dark:bg-neutral-900";

export default async function AdminDashboardPage() {
  const denuncias = await contarDenunciasAbertas();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <div className="grid gap-3 sm:grid-cols-2">
        <Link href="/admin/jogadores" className={cardClass}>
          <h2 className="font-bold">Jogadores</h2>
          <p className="text-sm text-neutral-500">
            Cadastrar elenco, gerar acessos e marcar goleiros. A nota é calculada pelas avaliações.
          </p>
        </Link>
        <Link href="/admin/peladas" className={cardClass}>
          <h2 className="font-bold">Peladas</h2>
          <p className="text-sm text-neutral-500">
            Marcar a próxima pelada, sortear times e lançar resultados.
          </p>
        </Link>
        <Link
          href="/admin/avaliacoes"
          className={
            denuncias > 0
              ? "rounded-xl border border-amber-400 bg-white p-4 shadow-sm hover:border-amber-500 dark:border-amber-700 dark:bg-neutral-900"
              : cardClass
          }
        >
          <h2 className="flex items-center gap-2 font-bold">
            Avaliações
            {denuncias > 0 && (
              <span className="rounded-full bg-amber-400 px-2 py-0.5 text-xs font-bold text-amber-950">
                {denuncias} para julgar
              </span>
            )}
          </h2>
          <p className="text-sm text-neutral-500">
            Acompanhar as rodadas e decidir as denúncias de nota injusta.
          </p>
        </Link>
      </div>
    </div>
  );
}
