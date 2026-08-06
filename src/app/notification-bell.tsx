import Link from "next/link";
import { contarNaoLidas } from "@/lib/notifications";

// Server Component: é só um link com contador, não precisa de JavaScript no
// cliente. O layout já tem a sessão em mãos, então custa uma consulta só.
export async function NotificationBell({ playerId }: { playerId: number }) {
  const naoLidas = await contarNaoLidas(playerId);

  return (
    <Link
      href="/notificacoes"
      aria-label={
        naoLidas > 0 ? `Notificações: ${naoLidas} não lidas` : "Notificações"
      }
      className="relative rounded-full bg-emerald-700 px-3 py-1 hover:bg-emerald-600"
    >
      🔔
      {naoLidas > 0 && (
        <span className="absolute -top-1 -right-1 min-w-5 rounded-full bg-amber-400 px-1 text-center text-xs font-bold text-amber-950">
          {naoLidas > 9 ? "9+" : naoLidas}
        </span>
      )}
    </Link>
  );
}
