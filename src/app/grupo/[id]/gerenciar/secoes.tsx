import { Badge } from "@/components/ui/badge";
import { SubmitButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader, Section } from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { Field, Input, Select } from "@/components/ui/field";
import { HairlineList, HairlineRow } from "@/components/ui/hairline-list";
import { PendingButton } from "@/components/ui/pending-button";
import type { Group } from "@/db/schema";
import { papelLabel } from "@/lib/grupos-permissions";
import { urlDoLink } from "@/lib/grupos";
import { BuscaJogador, type ItemJogador } from "@/components/ui/busca-jogador";
import {
  aprovarPedido,
  atualizarGrupo,
  definirPapel,
  excluirGrupo,
  gerarLinkDoGrupo,
  recusarPedido,
  removerMembro,
  revogarConvite,
  revogarLinkDoGrupo,
  transferirAdministracao,
} from "./actions";

// Mesma decomposição do painel da pelada, pelo mesmo motivo: eram 422 linhas
// com seis seções empilhadas num arquivo só.

type Membro = {
  playerId: number;
  name: string;
  nickname: string | null;
  papel: "admin" | "organizer" | "member";
  temConta: boolean;
};

export function SecaoDadosDoGrupo({ grupo, groupId }: { grupo: Group; groupId: number }) {
  return (
    <Section titulo="Dados do grupo">
      <Card>
        <CardBody>
          <form
            action={atualizarGrupo.bind(null, groupId)}
            className="flex flex-col gap-4"
          >
            <Field htmlFor="gr-name" label="Nome" obrigatorio>
              <Input id="gr-name" name="name" required defaultValue={grupo.name} />
            </Field>
            <Field htmlFor="gr-desc" label="Descrição">
              <Input
                id="gr-desc"
                name="description"
                defaultValue={grupo.description ?? ""}
                placeholder="Quarta às 20h, quadra do clube"
              />
            </Field>
            <div className="flex flex-wrap gap-4">
              <Field htmlFor="gr-vis" label="Quem encontra" className="min-w-52 flex-1">
                <Select id="gr-vis" name="visibility" defaultValue={grupo.visibility}>
                  <option value="private">Privado — só por convite</option>
                  <option value="public">Público — aparece na busca</option>
                </Select>
              </Field>
              <Field
                htmlFor="gr-join"
                label="Como se entra"
                className="min-w-52 flex-1"
                ajuda="Só vale em grupo público."
              >
                <Select id="gr-join" name="joinPolicy" defaultValue={grupo.joinPolicy}>
                  <option value="request">Sob aprovação</option>
                  <option value="open">Entrada livre</option>
                </Select>
              </Field>
            </div>
            <p className="text-[12px] leading-[1.45] text-fg-4">
              Ao tornar o grupo privado, os pedidos que estiverem na fila são recusados.
            </p>
            <SubmitButton className="self-start">Salvar</SubmitButton>
          </form>
        </CardBody>
      </Card>
    </Section>
  );
}

export function SecaoPedidos({
  groupId,
  pedidos,
}: {
  groupId: number;
  pedidos: { id: number; name: string; nickname: string | null }[];
}) {
  if (pedidos.length === 0) return null;
  return (
    <Section titulo="Pedidos de entrada">
      <Card className="border-warn-line">
        <CardHeader className="border-warn-line bg-warn-tint">
          <span className="font-display text-[14px] font-bold text-warn-ink">
            {pedidos.length} {pedidos.length === 1 ? "pessoa quer" : "pessoas querem"} entrar
          </span>
        </CardHeader>
        <ul className="flex flex-col">
          {pedidos.map((p) => (
            <li
              key={p.id}
              className="flex flex-wrap items-center gap-2 border-b border-line-soft px-4 py-3 last:border-0"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-display text-[14px] font-bold text-fg">
                  {p.nickname ?? p.name}
                </span>
                {p.nickname && (
                  <span className="block truncate text-[11.5px] text-fg-4">{p.name}</span>
                )}
              </span>
              {/* A fila muda debaixo do clique quando duas abas estão abertas. */}
              <form action={aprovarPedido.bind(null, groupId, p.id)}>
                <PendingButton tamanho="sm" labelPending="…">
                  Aprovar
                </PendingButton>
              </form>
              <form action={recusarPedido.bind(null, groupId, p.id)}>
                <PendingButton variante="secondary" tamanho="sm" labelPending="…">
                  Recusar
                </PendingButton>
              </form>
            </li>
          ))}
        </ul>
      </Card>
    </Section>
  );
}

export function SecaoMembros({
  groupId,
  membros,
  meuPlayerId,
}: {
  groupId: number;
  membros: Membro[];
  meuPlayerId: number;
}) {
  return (
    <Section titulo="Membros">
      <HairlineList as="ul">
        {membros.map((m) => {
          const souEu = m.playerId === meuPlayerId;
          return (
            <HairlineRow as="li" key={m.playerId} destaque={souEu}>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-display text-[14px] font-bold text-fg">
                  {m.nickname ?? m.name}
                </span>
                {m.nickname && (
                  <span className="block truncate text-[11.5px] text-fg-4">{m.name}</span>
                )}
              </span>
              <Badge tom={m.papel === "member" ? "neutral" : "accent"}>
                {papelLabel[m.papel]}
              </Badge>
              {!m.temConta && <Badge tom="dashed">sem conta</Badge>}

              <span className="ml-auto flex flex-wrap gap-1.5">
                {m.papel === "member" && (
                  <form action={definirPapel.bind(null, groupId, m.playerId, "organizer")}>
                    <SubmitButton variante="secondary" tamanho="sm">
                      Promover
                    </SubmitButton>
                  </form>
                )}
                {m.papel === "organizer" && (
                  <form action={definirPapel.bind(null, groupId, m.playerId, "member")}>
                    <SubmitButton variante="secondary" tamanho="sm">
                      Rebaixar
                    </SubmitButton>
                  </form>
                )}
                {m.papel !== "admin" && !souEu && (
                  <>
                    {/* Sem conta ativa não vira administrador: quem manda no
                        grupo precisa conseguir entrar. A action recusa do mesmo
                        jeito — aqui é só não oferecer o caminho. */}
                    {m.temConta && (
                      <form action={transferirAdministracao.bind(null, groupId, m.playerId)}>
                        {/* Só existe um admin por grupo: transferir por engano
                            tira o seu próprio poder de desfazer. */}
                        <PendingButton variante="secondary" tamanho="sm" labelPending="…">
                          Tornar admin
                        </PendingButton>
                      </form>
                    )}
                    <form action={removerMembro.bind(null, groupId, m.playerId)}>
                      <SubmitButton variante="danger-outline" tamanho="sm">
                        Remover
                      </SubmitButton>
                    </form>
                  </>
                )}
              </span>
            </HairlineRow>
          );
        })}
      </HairlineList>
    </Section>
  );
}

export function SecaoLink({
  groupId,
  link,
}: {
  groupId: number;
  link: { id: number; token: string; expiresAt: Date; maxUses: number | null; usesCount: number } | undefined;
}) {
  return (
    <Section titulo="Link de convite">
      <Card>
        <CardBody className="flex flex-col gap-3">
          {link ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-selo bg-surface-2 px-2.5 py-2 text-[12px] text-fg-2">
                  {urlDoLink(link.token)}
                </code>
                <CopyButton text={urlDoLink(link.token)} />
                <form action={revogarLinkDoGrupo.bind(null, groupId, link.id)}>
                  <SubmitButton variante="secondary" tamanho="sm">
                    Revogar
                  </SubmitButton>
                </form>
              </div>
              <p className="text-[12px] leading-[1.45] text-fg-4">
                Vale até {link.expiresAt.toLocaleDateString("pt-BR")}
                {link.maxUses !== null
                  ? ` · ${link.usesCount} de ${link.maxUses} usos`
                  : " · usos ilimitados"}
                . Quem abrir precisa ter conta e entra como membro.
              </p>
            </>
          ) : (
            <p className="text-[13px] text-fg-3">Nenhum link ativo.</p>
          )}

          <form
            action={gerarLinkDoGrupo.bind(null, groupId)}
            className="flex flex-wrap items-end gap-2 border-t border-line pt-3"
          >
            <Field htmlFor="maxUses" label="Limite de usos" className="w-40">
              <Input
                id="maxUses"
                name="maxUses"
                type="number"
                min={1}
                max={500}
                placeholder="Sem limite"
              />
            </Field>
            {/* Gerar duas vezes revoga o link que acabou de ir pro zap. */}
            <PendingButton variante="secondary" labelPending="Gerando…">
              {link ? "Gerar link novo" : "Gerar link"}
            </PendingButton>
          </form>

          {link && (
            <p className="text-[12px] leading-[1.45] text-warn-ink">
              Gerar um link novo revoga o atual — o que já foi mandado no zap para de funcionar.
            </p>
          )}
        </CardBody>
      </Card>
    </Section>
  );
}

export function SecaoConvidar({
  groupId,
  convites,
  candidatos,
}: {
  groupId: number;
  convites: { id: number; name: string; nickname: string | null }[];
  candidatos: ItemJogador[];
}) {
  return (
    <Section titulo="Convidar alguém">
      {convites.length > 0 && (
        <Card>
          <CardHeader>
            <span className="font-display text-[13px] font-bold text-fg">Aguardando resposta</span>
          </CardHeader>
          <ul className="flex flex-col">
            {convites.map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-center gap-2 border-b border-line-soft px-4 py-2.5 last:border-0"
              >
                <span className="min-w-0 flex-1 truncate font-display text-[14px] font-bold text-fg">
                  {c.nickname ?? c.name}
                </span>
                <form action={revogarConvite.bind(null, groupId, c.id)}>
                  <SubmitButton variante="secondary" tamanho="sm">
                    Revogar
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <BuscaJogador
        itens={candidatos}
        vazio="Todo mundo com conta já está no grupo ou foi convidado."
        semResultado="Nenhum jogador com esse nome."
      />

      <p className="text-[12px] leading-[1.45] text-fg-4">
        Só aparece aqui quem já tem conta. Para trazer alguém sem conta, inclua a pessoa numa
        pelada — de lá sai o link de cadastro dela.
      </p>
    </Section>
  );
}

export function ZonaDePerigoDoGrupo({
  groupId,
  grupo,
  totalPeladas,
}: {
  groupId: number;
  grupo: Group;
  totalPeladas: number;
}) {
  return (
    <Section titulo="Zona de perigo">
      <Card className="border-danger-line">
        <CardHeader className="border-danger-line bg-danger-tint">
          <span className="font-display text-[14px] font-extrabold font-stretch-112% text-danger-ink uppercase">
            Excluir grupo
          </span>
        </CardHeader>
        <CardBody className="flex flex-col gap-3">
          <p className="text-[13px] leading-[1.5] text-fg-2">
            Membros, convites e pedidos são apagados.{" "}
            {totalPeladas === 0
              ? "O grupo não tem peladas."
              : `As ${totalPeladas} peladas do grupo continuam existindo, mas viram peladas avulsas — placares, gols e notas ficam como estão.`}{" "}
            <strong className="text-fg">Não tem desfazer.</strong>
          </p>
          <form action={excluirGrupo.bind(null, groupId)} className="flex flex-col gap-3">
            <Field
              htmlFor="confirmacao"
              label={<>Digite “{grupo.name}” para confirmar</>}
              obrigatorio
            >
              <Input id="confirmacao" name="confirmacao" required autoComplete="off" />
            </Field>
            <PendingButton variante="danger" labelPending="Excluindo…" className="self-start">
              Excluir grupo
            </PendingButton>
          </form>
        </CardBody>
      </Card>
    </Section>
  );
}
