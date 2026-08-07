import { Badge } from "@/components/ui/badge";
import { CardLink, PageHeader, Section } from "@/components/ui/card";
import { IconeSeta } from "@/components/ui/icons";
import { StatGrid, StatTile } from "@/components/ui/stat";
import { getMetricas } from "@/lib/metricas";
import { contarDenunciasAbertas } from "@/lib/reports";
import { requirePlatformAdmin } from "@/lib/require-platform-admin";

export default async function AdminDashboardPage() {
  await requirePlatformAdmin();
  const [denuncias, m] = await Promise.all([contarDenunciasAbertas(), getMetricas()]);

  const atalhos = [
    {
      href: "/admin/jogadores",
      titulo: "Jogadores e contas",
      texto: "Cadastrar, gerar convites, resetar senha e ativar ou desativar contas.",
      selo: null,
    },
    {
      href: "/admin/peladas",
      titulo: "Supervisão de peladas",
      texto: "Ver todas as peladas e quem as criou; excluir pelada fabricada.",
      selo: null,
    },
    {
      href: "/admin/avaliacoes",
      titulo: "Avaliações",
      texto: "Acompanhar as rodadas e decidir as denúncias de nota injusta.",
      selo: denuncias > 0 ? `${denuncias} para julgar` : null,
    },
  ] as const;

  return (
    <div className="flex flex-col gap-7">
      <PageHeader
        titulo="Visão geral"
        descricao="O que a plataforma inteira está fazendo — todos os grupos, todas as peladas."
      />

      <Section titulo="Uso da plataforma">
        <StatGrid colunas={3}>
          <StatTile label="Jogadores ativos" valor={m.jogadoresAtivos} />
          <StatTile
            label="Contas ativas"
            valor={m.contasAtivas}
            nota={`${m.convitesPendentes} convite(s) pendente(s)`}
          />
          <StatTile
            label="Organizadores"
            valor={m.organizadores}
            nota="já criaram pelada"
          />
          <StatTile
            label="Peladas"
            valor={m.peladasTotal}
            nota={`${m.peladasUltimos30Dias} nos últimos 30 dias`}
          />
          <StatTile
            label="Rodadas abertas"
            valor={m.rodadasAbertas}
            nota={`${m.votacoesAbertas} votação(ões) em curso`}
          />
          <StatTile
            label="Peladas órfãs"
            valor={m.peladasOrfas}
            nota="sem responsável"
          />
        </StatGrid>
      </Section>

      <Section titulo="Administração">
        <div className="grid gap-3 sm:grid-cols-2">
          {atalhos.map((a) => (
            <CardLink
              key={a.href}
              href={a.href}
              className={a.selo ? "border-warn-line" : undefined}
            >
              <div className="flex items-start gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-display text-[15px] font-extrabold font-stretch-112% text-fg">
                    {a.titulo}
                    {a.selo && <Badge tom="warn">{a.selo}</Badge>}
                  </p>
                  <p className="mt-1 text-[13px] leading-[1.45] text-fg-3">{a.texto}</p>
                </div>
                <IconeSeta className="mt-0.5 size-4 shrink-0 text-fg-dim" />
              </div>
            </CardLink>
          ))}
        </div>
      </Section>
    </div>
  );
}
