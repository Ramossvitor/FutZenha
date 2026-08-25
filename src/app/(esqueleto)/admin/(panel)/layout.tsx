import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { IconeCadeado } from "@/components/ui/icons";
import { requirePlatformAdmin } from "@/lib/require-platform-admin";

const adminLinks = [
  { href: "/admin", label: "Visão geral" },
  { href: "/admin/jogadores", label: "Jogadores" },
  { href: "/admin/futs", label: "Supervisão" },
  { href: "/admin/avaliacoes", label: "Avaliações" },
  { href: "/admin/loja", label: "Loja" },
  { href: "/admin/zenhas", label: "Zenhas" },
  { href: "/admin/recargas", label: "Recargas" },
] as const;

// O guard aqui é rede, não garantia: layout não re-renderiza a cada navegação
// client-side dentro do próprio layout, então cada página repete o seu. Como
// getSession é memoizado por request, o par custa uma consulta só.
export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  await requirePlatformAdmin();

  return (
    <div className="flex flex-col gap-6">
      {/* A marcação é sóbria de propósito: uma faixa discreta que diz "você
          está mexendo no que é de todo mundo", sem virar um segundo produto
          com identidade própria. O Sair não fica aqui — mora no perfil e na
          lateral, iguais aos do resto do app. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card border border-warn-line bg-warn-tint px-3.5 py-2.5">
        <span className="flex items-center gap-2">
          <IconeCadeado className="size-4 text-warn-ink" />
          <Badge tom="warn">Plataforma</Badge>
        </span>
        <nav aria-label="Painel da plataforma" className="flex flex-wrap gap-x-4 gap-y-1">
          {adminLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="font-display text-[12.5px] font-semibold text-warn-ink hover:underline"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
      {children}
    </div>
  );
}
