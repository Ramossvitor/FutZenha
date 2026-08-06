import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { logout } from "@/app/login/actions";
import { getSession } from "@/lib/session";
import { siteUrl } from "@/lib/site-url";
import { NotificationBell } from "./notification-bell";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

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
  { href: "/artilharia", label: "Artilharia" },
  { href: "/rankings", label: "Rankings" },
] as const;

// Ler a sessão aqui torna todas as páginas dinâmicas por request — escolha
// deliberada para mostrar quem está logado em qualquer página.
export default async function RootLayout({ children }: LayoutProps<"/">) {
  const session = await getSession();
  return (
    <html
      lang="pt-BR"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
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
              {session?.role === "player" && (
                <>
                  <Link href="/avaliar" className="hover:underline">
                    Avaliar
                  </Link>
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
              {session?.role === "admin" && (
                <>
                  <Link
                    href="/admin"
                    className="rounded-full bg-emerald-700 px-3 py-1 hover:bg-emerald-600"
                  >
                    Admin
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
          FutZenha · <Link href="/admin" className="hover:underline">admin</Link>
        </footer>
      </body>
    </html>
  );
}
