import Link from "next/link";

export default function AdminDashboardPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <div className="grid gap-3 sm:grid-cols-2">
        <Link
          href="/admin/jogadores"
          className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm hover:border-emerald-600 dark:border-neutral-800 dark:bg-neutral-900"
        >
          <h2 className="font-bold">Jogadores</h2>
          <p className="text-sm text-neutral-500">Cadastrar elenco, notas e goleiros.</p>
        </Link>
        <Link
          href="/admin/peladas"
          className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm hover:border-emerald-600 dark:border-neutral-800 dark:bg-neutral-900"
        >
          <h2 className="font-bold">Peladas</h2>
          <p className="text-sm text-neutral-500">Marcar a próxima pelada, sortear times e lançar resultados.</p>
        </Link>
      </div>
    </div>
  );
}
