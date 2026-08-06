import Link from "next/link";
import { logout } from "@/app/login/actions";

const adminLinks = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/jogadores", label: "Jogadores" },
  { href: "/admin/peladas", label: "Peladas" },
  { href: "/admin/avaliacoes", label: "Avaliações" },
] as const;

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm dark:border-amber-700 dark:bg-amber-950">
        <span className="font-bold text-amber-800 dark:text-amber-300">Admin</span>
        <nav className="flex flex-wrap gap-3">
          {adminLinks.map((link) => (
            <Link key={link.href} href={link.href} className="font-medium hover:underline">
              {link.label}
            </Link>
          ))}
        </nav>
        <form action={logout} className="ml-auto">
          <button type="submit" className="text-neutral-500 hover:underline">
            Sair
          </button>
        </form>
      </div>
      {children}
    </div>
  );
}
