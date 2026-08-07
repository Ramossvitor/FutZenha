import type { Metadata } from "next";
import Link from "next/link";
import { logout } from "@/app/login/actions";
import { agendarProcessamento } from "@/lib/pendencias";
import { getSession } from "@/lib/session";
import { siteUrl } from "@/lib/site-url";
import { archivo, instrumentSans } from "./fonts";
import { NotificationBell } from "./notification-bell";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { default: "FutZenha", template: "%s — FutZenha" },
  description: "A pelada organizada: presença, times, artilharia e rankings.",
  openGraph: {
    title: "FutZenha ⚽",
    description: "Confirma presença, vê os times sorteados e acompanha a artilharia da pelada.",
    siteName: "FutZenha",
    locale: "pt_BR",
    type: "website",
  },
};

const navLinks = [
  { href: "/", label: "Início" },
  { href: "/peladas", label: "Peladas" },
  { href: "/grupos", label: "Grupos" },
  { href: "/artilharia", label: "Artilharia" },
  { href: "/rankings", label: "Rankings" },
] as const;

// Ler a sessão aqui torna todas as páginas dinâmicas por request — escolha
// deliberada para mostrar quem está logado em qualquer página.
export default async function RootLayout({ children }: LayoutProps<"/">) {
  const session = await getSession();
  // Prazos vencidos são aplicados depois da resposta, no máximo 1× por minuto
  // por instância. O cron diário é só a rede de segurança para quando o site
  // fica sem tráfego.
  agendarProcessamento();
  return (
    <html
      lang="pt-BR"
      className={`${archivo.variable} ${instrumentSans.variable} h-full antialiased`}
    >
      {/* Sem bg/text aqui: vem do @layer base do globals.css, que já troca com
          o tema sem precisar de variante `dark:`. */}
      <body className="flex min-h-full flex-col">
        <header className="bg-emerald-800 text-white">
          <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
            <Link href="/" className="text-lg font-black tracking-tight">
              ⚽ FutZenha
            </Link>
            <nav className="flex flex-wrap items-center gap-3 text-sm font-medium sm:gap-5">
              {navLinks.slice(1).map((link) => (
                <Link key={link.href} href={link.href} className="hover:underline">
                  {link.label}
                </Link>
              ))}
              {session && (
                <>
                  <Link href="/avaliar" className="hover:underline">
                    Avaliar
                  </Link>
                  {session.isPlatformAdmin && (
                    <Link href="/admin" className="hover:underline">
                      Admin
                    </Link>
                  )}
                  <NotificationBell playerId={session.player.id} />
                  <Link
                    href="/perfil"
                    className="rounded-full bg-emerald-700 px-3 py-1 hover:bg-emerald-600"
                  >
                    Olá, {session.player.nickname ?? session.player.name.split(" ")[0]}
                  </Link>
                  <form action={logout}>
                    <button type="submit" className="text-emerald-200 hover:underline">
                      Sair
                    </button>
                  </form>
                </>
              )}
              {!session && (
                <Link
                  href="/login"
                  className="rounded-full bg-emerald-700 px-3 py-1 hover:bg-emerald-600"
                >
                  Entrar
                </Link>
              )}
            </nav>
          </div>
        </header>
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">{children}</main>
        <footer className="border-t border-neutral-200 py-4 text-center text-xs text-neutral-500 dark:border-neutral-800">
          FutZenha
        </footer>
      </body>
    </html>
  );
}
