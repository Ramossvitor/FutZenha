import { Badge } from "@/components/ui/badge";
import { Button, SubmitButton } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Field, Input } from "@/components/ui/field";
import { IconeLuva } from "@/components/ui/icons";
import { Nota } from "@/components/ui/nota";
import type { Invite, Player, User } from "@/db/schema";
import { siteUrl } from "@/lib/site-url";
import {
  createInvite,
  revokeInvite,
  setPlatformAdmin,
  setPlayerActive,
  setUserActive,
  updatePlayer,
} from "./actions";

/** Os campos do jogador, iguais no cadastro e na edição. */
export function CamposDoJogador({ player }: { player?: Player }) {
  const sufixo = player ? `-${player.id}` : "-novo";
  return (
    <div className="flex flex-wrap items-end gap-3">
      <Field htmlFor={`nome${sufixo}`} label="Nome" obrigatorio className="min-w-44 flex-1">
        <Input id={`nome${sufixo}`} name="name" required defaultValue={player?.name} />
      </Field>
      <Field htmlFor={`apelido${sufixo}`} label="Apelido" className="min-w-36 flex-1">
        <Input
          id={`apelido${sufixo}`}
          name="nickname"
          defaultValue={player?.nickname ?? ""}
          placeholder="Como o pessoal chama"
        />
      </Field>
      {/* Só no cadastro: o e-mail pertence ao convite, não ao jogador. Editar um
          jogador que já existe não deve mexer no acesso dele. */}
      {!player && (
        <Field
          htmlFor="email-novo"
          label="E-mail (conta Google)"
          className="min-w-44 flex-1"
          ajuda="Opcional."
        >
          <Input id="email-novo" name="email" type="email" placeholder="fulano@gmail.com" />
        </Field>
      )}
      <label className="flex h-10 items-center gap-2 text-[13px] text-fg-2">
        <input
          name="isGoalkeeper"
          type="checkbox"
          defaultChecked={player?.isGoalkeeper}
          className="size-4 accent-[var(--accent)]"
        />
        Goleiro
      </label>
      <SubmitButton>{player ? "Salvar" : "Adicionar"}</SubmitButton>
    </div>
  );
}

/**
 * Bloco "Acesso" de um jogador: estado da conta e ciclo de vida do convite.
 *
 * Um convite pendente para quem já tem conta é um reset de senha. A expiração
 * vem calculada do banco (now() do Postgres) — a regra de pureza do React
 * proíbe Date.now() durante o render.
 */
export function SecaoDeAcesso({
  player,
  user,
  pending,
  euMesmo,
}: {
  player: Player;
  user?: User;
  pending?: { invite: Invite; expired: boolean };
  /** A própria conta de quem está olhando — não se rebaixa sozinho. */
  euMesmo: boolean;
}) {
  const invite = pending?.invite;
  const inviteUrl = invite ? `${siteUrl()}/convite/${invite.token}` : null;
  const convitePendente = pending != null && !pending.expired;
  const conviteExpirado = pending != null && pending.expired;

  return (
    <div className="flex flex-col gap-3 border-t border-line pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-display text-[13px] font-bold text-fg">Acesso</span>
        {!user && <Badge tom="dashed">sem conta</Badge>}
        {user && user.active && (
          <Badge tom="accent" caixa="normal">
            @{user.username}
          </Badge>
        )}
        {user && !user.active && <Badge tom="danger">conta desativada (@{user.username})</Badge>}
        {user?.isPlatformAdmin && <Badge tom="warn">admin da plataforma</Badge>}
        {conviteExpirado && <Badge tom="neutral">convite expirado</Badge>}
      </div>

      {convitePendente && invite && inviteUrl && (
        <div className="flex flex-wrap items-center gap-2">
          <Badge tom="warn">convite pendente</Badge>
          {invite.email && (
            <Badge tom="outline" caixa="normal">
              Google · {invite.email}
            </Badge>
          )}
          <code className="min-w-0 flex-1 truncate rounded-selo bg-surface-2 px-2 py-1 text-[11px] text-fg-2">
            {inviteUrl}
          </code>
          <CopyButton text={inviteUrl} />
          <span className="text-[11px] text-fg-4">
            expira{" "}
            {invite.expiresAt.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
          </span>
          <form action={revokeInvite.bind(null, player.id)}>
            <SubmitButton variante="ghost" tamanho="sm" className="text-danger-ink">
              Revogar
            </SubmitButton>
          </form>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        {/* Errou o e-mail? Revogar e gerar de novo — o convite trava no endereço
            digitado, então corrigi-lo é emitir outro. */}
        {!convitePendente && (
          <form
            action={createInvite.bind(null, player.id)}
            className="flex flex-wrap items-end gap-2"
          >
            <Field
              htmlFor={`convite-email-${player.id}`}
              label="E-mail da conta Google"
              className="w-60"
              ajuda="Opcional."
            >
              <Input
                id={`convite-email-${player.id}`}
                name="email"
                type="email"
                placeholder="fulano@gmail.com"
              />
            </Field>
            <SubmitButton variante="secondary">
              {user ? "Resetar acesso" : conviteExpirado ? "Gerar novo convite" : "Gerar convite"}
            </SubmitButton>
          </form>
        )}

        {user && (
          <form action={setUserActive.bind(null, user.id, !user.active)}>
            <SubmitButton variante={user.active ? "danger-outline" : "secondary"} tamanho="sm">
              {user.active ? "Desativar conta" : "Reativar conta"}
            </SubmitButton>
          </form>
        )}

        {user && !euMesmo && (
          <form action={setPlatformAdmin.bind(null, user.id, !user.isPlatformAdmin)}>
            <SubmitButton
              variante={user.isPlatformAdmin ? "danger-outline" : "secondary"}
              tamanho="sm"
            >
              {user.isPlatformAdmin ? "Tirar admin" : "Tornar admin"}
            </SubmitButton>
          </form>
        )}
      </div>

      {user?.isPlatformAdmin && (
        <p className="text-[12px] leading-[1.45] text-fg-4">
          Mexer neste papel encerra a sessão em curso da pessoa. Quem está em{" "}
          <code className="rounded-selo bg-surface-2 px-1">PLATFORM_ADMIN_USERNAMES</code> continua
          admin mesmo assim — a env var é chave-mestra e vence o banco.
        </p>
      )}
    </div>
  );
}

/** Uma linha do elenco: resumo no <summary>, edição e acesso ao abrir. */
export function LinhaDoJogador({
  player,
  user,
  pending,
  euMesmo,
}: {
  player: Player;
  user?: User;
  pending?: { invite: Invite; expired: boolean };
  euMesmo: boolean;
}) {
  return (
    <details className="overflow-hidden rounded-card border border-line bg-surface">
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-4 py-3">
        <span className="min-w-0 flex-1">
          <span className="block truncate font-display text-[14px] font-bold text-fg">
            {player.nickname ?? player.name}
          </span>
          {player.nickname && (
            <span className="block truncate text-[11.5px] text-fg-4">{player.name}</span>
          )}
        </span>
        {player.isGoalkeeper && (
          <Badge tom="warn">
            <IconeLuva className="size-3" />
            goleiro
          </Badge>
        )}
        {/* Sem conta ativa o jogador entra em campo normalmente, mas fica fora
            dos rankings e da avaliação — precisa aparecer aqui. */}
        {!user?.active && <Badge tom="dashed">sem acesso</Badge>}
        <Nota valor={player.skill} tamanho="sm" />
      </summary>

      <div className="flex flex-col gap-3 border-t border-line px-4 py-3">
        <form action={updatePlayer.bind(null, player.id)}>
          <CamposDoJogador player={player} />
        </form>
        <form action={setPlayerActive.bind(null, player.id, false)}>
          <Button type="submit" variante="ghost" tamanho="sm" className="text-danger-ink">
            Desativar — sai das listas, mantém o histórico
          </Button>
        </form>
        <SecaoDeAcesso player={player} user={user} pending={pending} euMesmo={euMesmo} />
      </div>
    </details>
  );
}
