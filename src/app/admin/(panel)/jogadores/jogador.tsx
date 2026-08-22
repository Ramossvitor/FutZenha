import { Badge } from "@/components/ui/badge";
import { SubmitButton } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Checkbox, Field, Input } from "@/components/ui/field";
import { AcaoDaLinha, LinhaDeCampos } from "@/components/ui/linha-de-campos";
import { IconeLuva } from "@/components/ui/icons";
import { Nota } from "@/components/ui/nota";
import type { Invite, Player, User } from "@/db/schema";
import { emailConfigurado } from "@/lib/email-envio";
import { siteUrl } from "@/lib/site-url";
import {
  createInvite,
  definirEmailDeContato,
  reenviarConvitePorEmail,
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
    <div className="flex flex-col gap-3">
      <LinhaDeCampos colunas={player ? ["medio", "medio"] : ["medio", "medio", "medio"]}>
        <Field htmlFor={`nome${sufixo}`} label="Nome" obrigatorio>
          <Input id={`nome${sufixo}`} name="name" required defaultValue={player?.name} />
        </Field>
        <Field htmlFor={`apelido${sufixo}`} label="Apelido">
          <Input
            id={`apelido${sufixo}`}
            name="nickname"
            defaultValue={player?.nickname ?? ""}
            placeholder="Como o pessoal chama"
          />
        </Field>
        {/* Só no cadastro: o e-mail pertence ao convite, não ao jogador. Editar
            um jogador que já existe não deve mexer no acesso dele. */}
        {!player && (
          <Field htmlFor="email-novo" label="E-mail (conta Google)" ajuda="Opcional.">
            <Input id="email-novo" name="email" type="email" placeholder="fulano@gmail.com" />
          </Field>
        )}
      </LinhaDeCampos>
      {/* Checkbox e botão descem para a própria linha: como colunas eles
          empurrariam os campos para larguras de duas palavras no celular. */}
      <div className="flex flex-wrap items-center gap-3">
        <Checkbox name="isGoalkeeper" defaultChecked={player?.isGoalkeeper} label="Goleiro" />
        <SubmitButton>{player ? "Salvar" : "Adicionar"}</SubmitButton>
      </div>
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
          {invite.emailSentAt && (
            <Badge tom="neutral" caixa="normal">
              e-mail enviado{" "}
              {invite.emailSentAt.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
            </Badge>
          )}
          {/* Linha própria, não `flex-1`: dividindo a faixa com os selos, a URL
              sobrava com meia dúzia de caracteres antes das reticências. */}
          <code className="w-full min-w-0 truncate rounded-selo bg-surface-2 px-2 py-1 text-[11px] text-fg-2">
            {inviteUrl}
          </code>
          <CopyButton text={inviteUrl} />
          {/* Reenviar usa o mesmo token — um link já entregue no WhatsApp segue
              valendo. Sem key do Resend (preview, dev) o botão some, como o
              botão do Google sem credencial. */}
          {invite.email && emailConfigurado() && (
            <form action={reenviarConvitePorEmail.bind(null, player.id)}>
              <SubmitButton variante="secondary" tamanho="sm">
                Reenviar e-mail
              </SubmitButton>
            </form>
          )}
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

      {/* Coluna, não linha: são dois formulários independentes, e o
          `flex-wrap items-end` daqui fazia um se alinhar pelo outro. */}
      <div className="flex flex-col gap-4">
        {/* Errou o e-mail? Revogar e gerar de novo — o convite trava no endereço
            digitado, então corrigi-lo é emitir outro. */}
        {!convitePendente && (
          <form action={createInvite.bind(null, player.id)}>
            <LinhaDeCampos colunas={["medio", "acao"]}>
              <Field
                htmlFor={`convite-email-${player.id}`}
                label="E-mail da conta Google"
                ajuda="Opcional."
              >
                <Input
                  id={`convite-email-${player.id}`}
                  name="email"
                  type="email"
                  placeholder="fulano@gmail.com"
                />
              </Field>
              <AcaoDaLinha>
                <SubmitButton variante="secondary">
                  {user
                    ? "Resetar acesso"
                    : conviteExpirado
                      ? "Gerar novo convite"
                      : "Gerar convite"}
                </SubmitButton>
              </AcaoDaLinha>
            </LinhaDeCampos>
          </form>
        )}

        {/* Mora em `users`, então só existe para quem já tem conta. Quem ainda
            não tem recebe o endereço pelo convite ou digita ao criar a conta. */}
        {user && (
          <form action={definirEmailDeContato.bind(null, user.id)}>
            <LinhaDeCampos colunas={["medio", "acao"]}>
              <Field
                htmlFor={`contato-${user.id}`}
                label="E-mail de contato"
                ajuda={
                  user.email
                    ? `Os avisos vão para ${user.email} (conta Google) — este campo fica de reserva.`
                    : "Só para avisos. Não vale para entrar pelo Google."
                }
              >
                <Input
                  id={`contato-${user.id}`}
                  name="contactEmail"
                  type="email"
                  defaultValue={user.contactEmail ?? ""}
                  placeholder="fulano@example.com"
                />
              </Field>
              <AcaoDaLinha>
                <SubmitButton variante="secondary">Salvar contato</SubmitButton>
              </AcaoDaLinha>
            </LinhaDeCampos>
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
          <SubmitButton variante="ghost" tamanho="sm" className="text-danger-ink">
            Desativar — sai das listas, mantém o histórico
          </SubmitButton>
        </form>
        <SecaoDeAcesso player={player} user={user} pending={pending} euMesmo={euMesmo} />
      </div>
    </details>
  );
}
