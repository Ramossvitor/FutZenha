import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
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
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
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

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pt-BR"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
        <header className="bg-emerald-800 text-white">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-3">
            <Link href="/" className="text-lg font-black tracking-tight">
              ⚽ FutZenha
            </Link>
            <nav className="flex gap-3 text-sm font-medium sm:gap-5">
              {navLinks.slice(1).map((link) => (
                <Link key={link.href} href={link.href} className="hover:underline">
                  {link.label}
                </Link>
              ))}
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
