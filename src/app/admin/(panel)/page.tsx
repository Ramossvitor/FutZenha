import Link from "next/link";
import { getMetricas } from "@/lib/metricas";
import { contarDenunciasAbertas } from "@/lib/reports";
import { requirePlatformAdmin } from "@/lib/require-platform-admin";

const cardClass =
  "rounded-xl border border-neutral-200 bg-white p-4 shadow-sm hover:border-emerald-600 dark:border-neutral-800 dark:bg-neutral-900";

function Metrica({ label, valor, nota }: { label: string; valor: number; nota?: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
      <p className="text-2xl font-bold tabular-nums">{valor}</p>
      <p className="text-sm font-medium">{label}</p>
      {nota && <p className="text-xs text-neutral-500">{nota}</p>}
    </div>
  );
}

export default async function AdminDashboardPage() {
  await requirePlatformAdmin();
  const [denuncias, m] = await Promise.all([contarDenunciasAbertas(), getMetricas()]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-neutral-500">Uso da plataforma</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Metrica label="Jogadores ativos" valor={m.jogadoresAtivos} />
          <Metrica
            label="Contas ativas"
            valor={m.contasAtivas}
            nota={`${m.convitesPendentes} convite(s) pendente(s)`}
          />
          <Metrica
            label="Organizadores"
            valor={m.organizadores}
            nota="pessoas que já criaram pelada"
          />
          <Metrica
            label="Peladas"
            valor={m.peladasTotal}
            nota={`${m.peladasUltimos30Dias} nos últimos 30 dias`}
          />
          <Metrica
            label="Rodadas de avaliação abertas"
            valor={m.rodadasAbertas}
            nota={`${m.votacoesAbertas} votação(ões) de exclusão em curso`}
          />
          <Metrica
            label="Peladas sem responsável"
            valor={m.peladasOrfas}
            nota="anteriores ao modelo ou de criador removido"
          />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-neutral-500">Administração</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Link href="/admin/jogadores" className={cardClass}>
            <h3 className="font-bold">Jogadores e contas</h3>
            <p className="text-sm text-neutral-500">
              Cadastrar, gerar convites, resetar senha e ativar/desativar contas.
            </p>
          </Link>
          <Link href="/admin/peladas" className={cardClass}>
            <h3 className="font-bold">Supervisão de peladas</h3>
            <p className="text-sm text-neutral-500">
              Ver todas as peladas e quem as criou; excluir pelada fabricada.
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
            <h3 className="flex items-center gap-2 font-bold">
              Avaliações
              {denuncias > 0 && (
                <span className="rounded-full bg-amber-400 px-2 py-0.5 text-xs font-bold text-amber-950">
                  {denuncias} para julgar
                </span>
              )}
            </h3>
            <p className="text-sm text-neutral-500">
              Acompanhar as rodadas e decidir as denúncias de nota injusta.
            </p>
          </Link>
        </div>
      </section>
    </div>
  );
}
