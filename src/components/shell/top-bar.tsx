import Link from "next/link";
import { Avatar } from "@/components/ui/avatar";
import { IconeSino } from "@/components/ui/icons";
import type { GrupoAtual } from "@/lib/grupo-atual";
import type { Session } from "@/lib/session";
import { ChipDoGrupo } from "./chip-do-grupo";
import { WordmarkLink } from "./marca";

function Contador({ n }: { n: number }) {
  return (
    <span className="absolute -top-1.5 -right-1.5 inline-flex min-w-[18px] items-center justify-center rounded-full border-2 border-nav bg-danger px-1 font-display text-[10px] leading-[14px] font-extrabold text-on-danger">
      {n > 9 ? "9+" : n}
    </span>
  );
}

/**
 * A barra de cima no celular. Some no desktop, onde a lateral faz o papel.
 *
 * Deslogado não há contexto de grupo — o chip daria a entender que existe algo
 * para escolher —, então entra o logotipo no lugar.
 */
export function TopBar({
  session,
  grupo,
  naoLidas,
}: {
  session: Session | null;
  grupo: GrupoAtual | null;
  naoLidas: number;
}) {
  return (
    <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-line bg-nav px-3 py-2 lg:hidden">
      {session ? (
        <ChipDoGrupo grupo={grupo} className="min-w-0 flex-1" />
      ) : (
        <WordmarkLink tamanho="sm" className="flex-1" />
      )}

      {session ? (
        <>
          <Link
            href="/notificacoes"
            aria-label={naoLidas > 0 ? `Avisos: ${naoLidas} não lidos` : "Avisos"}
            className="relative flex size-10 shrink-0 items-center justify-center rounded-ctl border border-line bg-surface text-fg-2 transition-colors hover:border-line-hover hover:text-fg"
          >
            <IconeSino className="size-[18px]" />
            {naoLidas > 0 && <Contador n={naoLidas} />}
          </Link>
          <Link
            href="/perfil"
            aria-label="Meu perfil"
            className="shrink-0 rounded-full transition-opacity hover:opacity-80"
          >
            <Avatar nome={session.player.nickname ?? session.player.name} tamanho="md" />
          </Link>
        </>
      ) : (
        <Link
          href="/login"
          className="shrink-0 rounded-ctl border border-accent-edge bg-accent px-3.5 py-2 font-display text-[13px] font-semibold font-stretch-112% text-on-accent"
        >
          Entrar
        </Link>
      )}
    </header>
  );
}
