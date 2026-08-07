import { responderConvite } from "@/app/grupo/[id]/actions";
import { Badge } from "@/components/ui/badge";
import { BannerDaQuery } from "@/components/ui/banner";
import { Button, LinkButton, SubmitButton } from "@/components/ui/button";
import { Card, Eyebrow, PageHeader, Section } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input } from "@/components/ui/field";
import { HairlineList, HairlineRowLink } from "@/components/ui/hairline-list";
import { IconeCheck, IconeSeta } from "@/components/ui/icons";
import { Nota } from "@/components/ui/nota";
import { getGrupoAtual } from "@/lib/grupo-atual";
import { convitesPendentes, listarGruposPublicos, listarMeusGrupos } from "@/lib/grupos";
import { papelLabel } from "@/lib/grupos-permissions";
import { requirePlayer } from "@/lib/require-player";
import { trocarGrupo } from "./actions";

export const metadata = { title: "Grupos" };
export const dynamic = "force-dynamic";

export default async function GruposPage({ searchParams }: PageProps<"/grupos">) {
  const session = await requirePlayer();
  const { busca, erro, ok } = await searchParams;
  const termo = typeof busca === "string" ? busca : "";

  const [meus, convites, publicos, atual] = await Promise.all([
    listarMeusGrupos(session.player.id),
    convitesPendentes(session.player.id),
    listarGruposPublicos(termo),
    getGrupoAtual(),
  ]);

  // Grupo de que já participo não precisa aparecer em "descobrir".
  const meusIds = new Set(meus.map((g) => g.id));
  const paraDescobrir = publicos.filter((g) => !meusIds.has(g.id));

  return (
    <div className="flex flex-col gap-7">
      <PageHeader
        titulo={<>Boa, {session.player.nickname ?? session.player.name.split(" ")[0]}</>}
        descricao="Escolhe onde você vai jogar. O grupo escolhido filtra o início, as peladas e os rankings."
        acao={
          <LinkButton href="/grupos/novo" variante="secondary" tamanho="sm">
            Criar grupo
          </LinkButton>
        }
      />

      <BannerDaQuery erro={erro} ok={ok} />

      {/* A nota aparece uma vez só, e fora dos cards, porque ela é uma só: o
          banco guarda um `players.skill` por pessoa, não um por grupo. Repetir
          o mesmo número dentro de cada card daria a entender que ele muda de um
          para o outro — e essa foi uma decisão explícita do projeto, não uma
          simplificação. */}
      <Card className="flex items-center gap-4 p-4">
        <div className="flex-1">
          <Eyebrow>Sua nota</Eyebrow>
          <p className="mt-1 text-[13px] leading-[1.45] text-fg-3">
            Uma só, somando todas as peladas que você jogou — em qualquer grupo.
          </p>
        </div>
        <Nota valor={session.player.skill} tamanho="xl" />
      </Card>

      {convites.length > 0 && (
        <Section titulo="Chamaram você">
          <div className="flex flex-col gap-2">
            {convites.map((c) => (
              <Card key={c.id} className="border-warn-line bg-warn-tint p-4">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-display text-[16px] font-extrabold font-stretch-112% text-fg">
                      {c.groupName}
                    </p>
                    <p className="text-[13px] leading-[1.45] text-fg-2">
                      {c.convidadoPor ? `Convite de ${c.convidadoPor}` : "Você foi convidado"}
                      {c.groupDescription && ` · ${c.groupDescription}`}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <form action={responderConvite.bind(null, c.groupId, c.id, true)}>
                      <SubmitButton tamanho="sm">Aceitar</SubmitButton>
                    </form>
                    <form action={responderConvite.bind(null, c.groupId, c.id, false)}>
                      <SubmitButton variante="secondary" tamanho="sm">
                        Recusar
                      </SubmitButton>
                    </form>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </Section>
      )}

      <Section titulo="Onde você joga">
        <div className="flex flex-col gap-2">
          {/* O contexto sem grupo precisa ser uma escolha visível, e não a
              ausência de escolha: pelada avulsa (sem grupo) é como o produto
              funcionava antes, e só aparece aqui. */}
          <CartaoDeContexto
            ativo={atual === null}
            titulo="Todas as peladas"
            meta="Tudo junto, inclusive as peladas sem grupo"
            groupId={null}
          />

          {meus.map((g) => (
            <CartaoDeContexto
              key={g.id}
              ativo={atual?.id === g.id}
              titulo={g.name}
              meta={`${papelLabel[g.papel]} · ${g.membros} ${g.membros === 1 ? "pessoa" : "pessoas"}`}
              descricao={g.description}
              privado={g.visibility === "private"}
              groupId={g.id}
            />
          ))}

          {meus.length === 0 && (
            <EmptyState
              titulo="Você ainda não está em nenhum grupo"
              descricao="Grupo se entra por convite ou pelo link que mandam no zap. Se ninguém te chamou ainda, dá para criar o seu."
              acao={
                <LinkButton href="/grupos/novo" variante="primary" tamanho="sm">
                  Criar um grupo
                </LinkButton>
              }
            />
          )}
        </div>
      </Section>

      <Section titulo="Descobrir">
        <form action="/grupos" className="flex items-end gap-2">
          <Field htmlFor="busca" label="Procurar grupo público" className="flex-1">
            <Input id="busca" name="busca" defaultValue={termo} placeholder="Nome do grupo" />
          </Field>
          <Button type="submit" variante="secondary">
            Buscar
          </Button>
        </form>

        <HairlineList
          as="ul"
          vazio={
            <EmptyState
              titulo={termo ? "Nenhum grupo com esse nome" : "Nenhum grupo público por enquanto"}
              descricao={
                termo
                  ? "Só aparecem aqui os grupos marcados como públicos."
                  : "Grupo privado não aparece na busca — para entrar num, é por convite."
              }
            />
          }
        >
          {paraDescobrir.map((g) => (
            <li key={g.id}>
              <HairlineRowLink href={`/grupo/${g.id}`}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-display font-bold text-fg">{g.name}</span>
                  {g.description && (
                    <span className="block truncate text-[12.5px] text-fg-4">{g.description}</span>
                  )}
                </span>
                {g.joinPolicy === "open" && <Badge tom="accent">entrada livre</Badge>}
                <span className="text-[12px] text-fg-4">
                  {g.membros} {g.membros === 1 ? "pessoa" : "pessoas"}
                </span>
                <IconeSeta className="size-4 text-fg-dim" />
              </HairlineRowLink>
            </li>
          ))}
        </HairlineList>
      </Section>
    </div>
  );
}

/**
 * Um destino de contexto. O corpo do cartão é o botão que troca o grupo e leva
 * ao início; a página do grupo fica num link à parte, embaixo, para os dois
 * alvos não brigarem pelo mesmo toque.
 */
function CartaoDeContexto({
  ativo,
  titulo,
  meta,
  descricao,
  privado = false,
  groupId,
}: {
  ativo: boolean;
  titulo: string;
  meta: string;
  descricao?: string | null;
  privado?: boolean;
  groupId: number | null;
}) {
  return (
    <Card className={ativo ? "border-accent-edge" : undefined}>
      <form action={trocarGrupo.bind(null, groupId)}>
        <button
          type="submit"
          className="flex w-full items-center gap-3 rounded-t-card px-4 py-3.5 text-left transition-colors hover:bg-surface-2"
        >
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-display text-[18px] leading-[1.2] font-extrabold font-stretch-112% text-fg">
                {titulo}
              </span>
              {privado && <Badge tom="outline">privado</Badge>}
              {ativo && (
                <Badge tom="accent" ponto>
                  aqui
                </Badge>
              )}
            </span>
            <span className="mt-0.5 block text-[12.5px] text-fg-3">{meta}</span>
            {descricao && (
              <span className="mt-0.5 block truncate text-[12.5px] text-fg-4">{descricao}</span>
            )}
          </span>
          {ativo ? (
            <IconeCheck className="size-5 shrink-0 text-accent-ink" />
          ) : (
            <IconeSeta className="size-4 shrink-0 text-fg-dim" />
          )}
        </button>
      </form>

      {groupId !== null && (
        <div className="border-t border-line px-4 py-2">
          <HairlineRowLink
            href={`/grupo/${groupId}`}
            className="-mx-4 -my-2 bg-transparent text-[12.5px] text-accent-ink hover:bg-transparent hover:underline"
          >
            Ver a página do grupo
          </HairlineRowLink>
        </div>
      )}
    </Card>
  );
}
