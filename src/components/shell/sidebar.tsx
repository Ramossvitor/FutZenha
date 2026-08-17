import Link from "next/link";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { LinkButton, SubmitButton } from "@/components/ui/button";
import type { GrupoAtual } from "@/lib/grupo-atual";
import { papelLabel } from "@/lib/grupos-permissions";
import { WordmarkLink } from "@/components/ui/marca";
import type { Session } from "@/lib/session";
import { BotaoAtualizar } from "./botao-atualizar";
import { ChipDoGrupo } from "./chip-do-grupo";
import { itensLaterais } from "./nav-items";
import { NavLink } from "./nav-link";

/**
 * A navegação do desktop: coluna fixa de 236px.
 *
 * Não é a tab bar esticada — cabe mais coisa, então Grupos, Avaliar e Avisos
 * saem do topo e viram itens de primeira classe, e o rodapé ganha o bloco de
 * quem está logado com o Sair.
 */
export function Sidebar({
  session,
  grupo,
  temSeletor,
  naoLidas,
  aoSair,
}: {
  session: Session | null;
  grupo: GrupoAtual | null;
  temSeletor: boolean;
  naoLidas: number;
  /**
   * A Server Action do Sair, injetada pelo layout.
   *
   * Vem por prop e não por import porque `@/app/login/actions` é `"use server"`
   * e puxa o grafo inteiro de banco e senha: importá-lo daqui faria a única
   * aresta de `src/components/` para dentro de `src/app/` de todo o projeto.
   */
  aoSair: () => Promise<void>;
}) {
  const itens = itensLaterais({
    logado: session !== null,
    isPlatformAdmin: session?.isPlatformAdmin ?? false,
  });

  return (
    <aside className="sticky top-0 hidden h-dvh w-[236px] shrink-0 flex-col gap-5 border-r border-line bg-nav px-3.5 py-4 lg:flex">
      {/* O botão de atualizar entra aqui e não na navegação: ele não leva a
          lugar nenhum, e um item de ação no meio dos links mentiria sobre isso.
          No celular este papel é do gesto de puxar (puxar-para-atualizar.tsx).

          O wordmark caiu de `md` para `sm` por causa dele: em `md` a marca mede
          169px dos 208px úteis da coluna (236 menos o px-3.5 dos dois lados), e
          com o gap e o botão a conta dava 221 — o botão entrava POR CIMA das
          últimas letras. Nem botão menor nem gap menor resolviam sem deixar a
          folga em 1px. Em `sm` sobram 23px entre a marca e o botão. */}
      <div className="flex items-center gap-2">
        <WordmarkLink tamanho="sm" className="min-w-0 flex-1 px-1" />
        <BotaoAtualizar />
      </div>

      {session && <ChipDoGrupo forma="lateral" grupo={grupo} temSeletor={temSeletor} />}

      {/* Rótulo diferente do da tab bar: as duas ficam no DOM ao mesmo tempo, e
          só o `display:none` do breakpoint separa uma da outra. Dois marcos de
          navegação com o mesmo nome confundem quem navega por landmark. */}
      <nav aria-label="Navegação lateral" className="flex flex-col gap-0.5">
        {itens.map((item) => (
          <NavLink
            key={item.href}
            href={item.href}
            label={item.label}
            icone={item.icone}
            exato={item.exato}
            forma="lateral"
            selo={
              item.href === "/notificacoes" && naoLidas > 0 ? (
                <Badge tom="danger">{naoLidas > 9 ? "9+" : naoLidas}</Badge>
              ) : undefined
            }
          />
        ))}
      </nav>

      <div className="flex-1" />

      {session ? (
        <div className="flex flex-col gap-2 border-t border-line pt-3">
          <Link
            href="/perfil"
            className="flex min-w-0 items-center gap-2.5 rounded-ctl px-1 py-1 transition-colors hover:bg-surface-2"
          >
            <Avatar nome={session.player.nickname ?? session.player.name} tamanho="sm" />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-display text-[13px] font-bold text-fg">
                {session.player.nickname ?? session.player.name.split(" ")[0]}
              </span>
              <span className="block truncate text-[11px] text-fg-4">
                {grupo ? papelLabel[grupo.papel] : `@${session.username}`}
              </span>
            </span>
          </Link>
          <form action={aoSair}>
            <SubmitButton
              variante="ghost"
              tamanho="sm"
              labelPending="Saindo…"
              className="w-full justify-start"
            >
              Sair
            </SubmitButton>
          </form>
        </div>
      ) : (
        <div className="border-t border-line pt-3">
          <LinkButton href="/login" variante="primary" tamanho="sm" className="w-full">
            Entrar
          </LinkButton>
        </div>
      )}
    </aside>
  );
}
