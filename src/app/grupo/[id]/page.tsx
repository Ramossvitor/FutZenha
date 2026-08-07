import { notFound } from "next/navigation";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { Badge } from "@/components/ui/badge";
import { BannerDaQuery } from "@/components/ui/banner";
import { LinkButton, SubmitButton } from "@/components/ui/button";
import { PageHeader, Section } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { HairlineList, HairlineRow, HairlineRowLink } from "@/components/ui/hairline-list";
import { VestChip } from "@/components/ui/vest";
import { STATUS_PELADA } from "@/lib/match-day-form";
import { db } from "@/db";
import { games, matchDays, teams } from "@/db/schema";
import { formatDate, formatDateShort, formatTime } from "@/lib/format";
import { papelLabel, podeEntrarNoGrupo, podeVerGrupo } from "@/lib/grupos-permissions";
import { getGrupo, listarMembros, papelNoGrupo, temPedidoPendente } from "@/lib/grupos";
import { podeGerenciarPelada } from "@/lib/permissions";
import { getSession } from "@/lib/session";
import { cancelarPedido, entrarNoGrupo, pedirEntrada, sairDoGrupo } from "./actions";

export const dynamic = "force-dynamic";


/**
 * O título repete a checagem de visibilidade, e não é redundância.
 *
 * `generateMetadata` roda **antes** do corpo da página e não é abortado pelo
 * `notFound()` de lá: sem este teste, o grupo privado respondia 404 com
 * `<title>Grupo Secreto — FutZenha</title>` no HTML. O status escondia a
 * página; o título entregava o nome de todo grupo privado da plataforma para
 * quem varresse os ids.
 */
export async function generateMetadata({ params }: PageProps<"/grupo/[id]">) {
  const generico = { title: "Grupo" };
  const { id } = await params;
  const groupId = Number(id);
  if (!Number.isInteger(groupId)) return generico;

  const grupo = await getGrupo(groupId);
  if (!grupo) return generico;

  // Grupo público tem nome público — inclusive para quem não está logado, que é
  // o caso do link compartilhado.
  if (grupo.visibility === "public") return { title: grupo.name };

  const session = await getSession();
  if (!session) return generico;
  const papel = await papelNoGrupo(groupId, session.player.id);
  const ator = { playerId: session.player.id, isPlatformAdmin: session.isPlatformAdmin };
  return podeVerGrupo(ator, grupo, papel) ? { title: grupo.name } : generico;
}

/**
 * A página do grupo — a única rota de grupo que atende quem não é membro, e por
 * isso a única sem guard `require*`.
 *
 * A checagem de visibilidade é feita na mão logo abaixo. Um esquecimento aqui
 * não dá erro nenhum: só entrega a lista de membros de todo grupo privado da
 * plataforma para quem souber somar 1 no id.
 */
export default async function GrupoPage({ params, searchParams }: PageProps<"/grupo/[id]">) {
  const { id } = await params;
  const groupId = Number(id);
  if (!Number.isInteger(groupId)) notFound();

  const { erro, ok } = await searchParams;

  const grupo = await getGrupo(groupId);
  if (!grupo) notFound();

  const session = await getSession();
  const ator = session
    ? { playerId: session.player.id, isPlatformAdmin: session.isPlatformAdmin }
    : null;
  const papel = session ? await papelNoGrupo(groupId, session.player.id) : null;

  // Deslogado só enxerga grupo público; quem está de fora de um privado leva o
  // mesmo 404 de id inexistente.
  if (!ator) {
    if (grupo.visibility !== "public") notFound();
  } else if (!podeVerGrupo(ator, grupo, papel)) {
    notFound();
  }

  const [membros, days, pedido] = await Promise.all([
    listarMembros(groupId),
    db
      .select()
      .from(matchDays)
      .where(eq(matchDays.groupId, groupId))
      .orderBy(desc(matchDays.date), desc(matchDays.id)),
    session && papel === null ? temPedidoPendente(groupId, session.player.id) : Promise.resolve(false),
  ]);

  const dayIds = days.map((d) => d.id);
  const gameRows = dayIds.length
    ? await db
        .select()
        .from(games)
        .where(inArray(games.matchDayId, dayIds))
        .orderBy(asc(games.sortOrder), asc(games.id))
    : [];
  const teamRows = dayIds.length
    ? await db.select().from(teams).where(inArray(teams.matchDayId, dayIds))
    : [];
  const teamNameById = new Map(teamRows.map((t) => [t.id, t.name]));

  const entrada = session ? podeEntrarNoGrupo(grupo, papel) : "so-convite";
  const podeCriarPelada = papel === "admin" || papel === "organizer";
  // O organizador também chega em /gerenciar — é de lá que ele gera o link e
  // convida, que é metade do papel dele.
  const podeGerenciar = podeCriarPelada || session?.isPlatformAdmin === true;

  return (
    <div className="flex flex-col gap-7">
      <PageHeader
        titulo={grupo.name}
        selos={
          <>
            {papel && <Badge tom="accent">{papelLabel[papel]}</Badge>}
            {grupo.visibility === "private" && <Badge tom="outline">privado</Badge>}
            {grupo.joinPolicy === "open" && grupo.visibility === "public" && (
              <Badge tom="outline">entrada livre</Badge>
            )}
          </>
        }
        descricao={grupo.description}
        acao={
          podeCriarPelada ? (
            <LinkButton href={`/peladas/nova?grupo=${groupId}`} tamanho="sm">
              Marcar pelada
            </LinkButton>
          ) : session && entrada === "entra-direto" ? (
            <form action={entrarNoGrupo.bind(null, groupId)}>
              <SubmitButton tamanho="sm">Entrar no grupo</SubmitButton>
            </form>
          ) : session && entrada === "pede-entrada" && !pedido ? (
            <form action={pedirEntrada.bind(null, groupId)}>
              <SubmitButton tamanho="sm">Pedir para entrar</SubmitButton>
            </form>
          ) : undefined
        }
      />

      <BannerDaQuery erro={erro} ok={ok} />

      <div className="flex flex-wrap items-center gap-2">
        {papel && (
          <LinkButton href={`/grupo/${groupId}/ranking`} variante="secondary" tamanho="sm">
            Ranking do grupo
          </LinkButton>
        )}
        {podeGerenciar && (
          <LinkButton href={`/grupo/${groupId}/gerenciar`} variante="secondary" tamanho="sm">
            Gerenciar
          </LinkButton>
        )}
        {session && entrada === "pede-entrada" && pedido && (
          <form action={cancelarPedido.bind(null, groupId)} className="flex items-center gap-2">
            <Badge tom="warn">pedido aguardando</Badge>
            <SubmitButton variante="ghost" tamanho="sm">
              Cancelar pedido
            </SubmitButton>
          </form>
        )}
        {/* O admin não sai: sairia deixando o grupo sem ninguém no comando.
            Transferir primeiro é a regra que a action aplica. */}
        {papel && papel !== "admin" && (
          <form action={sairDoGrupo.bind(null, groupId)} className="ml-auto">
            <SubmitButton variante="ghost" tamanho="sm" className="text-danger-ink">
              Sair do grupo
            </SubmitButton>
          </form>
        )}
      </div>

      <Section titulo="Peladas do grupo">
        <HairlineList
          as="ul"
          vazio={
            <EmptyState
              titulo="Nenhuma pelada marcada"
              descricao={
                podeCriarPelada
                  ? "Marque a primeira e ela aparece aqui."
                  : "Quem organiza é quem marca."
              }
            />
          }
        >
          {days.map((day) => {
            const dayGames = gameRows.filter((g) => g.matchDayId === day.id);
            const euGerencio = ator !== null && podeGerenciarPelada(ator, day, papel);
            return (
              <li key={day.id}>
                <HairlineRowLink href={`/pelada/${day.id}`} className="items-start">
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-display text-[15px] font-bold text-fg capitalize">
                        {formatDate(day.date)}
                      </span>
                      <span className="font-display text-[12px] font-semibold text-fg-4" data-num>
                        {formatDateShort(day.date)}
                      </span>
                      {euGerencio && <Badge tom="warn">você gerencia</Badge>}
                      <Badge tom={day.status === "finished" ? "neutral" : "accent"}>
                        {STATUS_PELADA[day.status]}
                      </Badge>
                    </span>
                    <span className="mt-0.5 block text-[13px] text-fg-3">
                      {formatTime(day.startTime) && <>{formatTime(day.startTime)} · </>}
                      {day.location}
                    </span>
                    {dayGames.length > 0 && (
                      <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                        {dayGames.map((g) => (
                          <span key={g.id} className="flex items-center gap-1.5">
                            <VestChip time={teamNameById.get(g.teamAId) ?? ""} tamanho="sm" />
                            <span
                              className="font-display text-[13px] font-extrabold font-stretch-112% text-fg-2"
                              data-num
                            >
                              {g.scoreA} × {g.scoreB}
                            </span>
                            <VestChip time={teamNameById.get(g.teamBId) ?? ""} tamanho="sm" />
                          </span>
                        ))}
                      </span>
                    )}
                  </span>
                </HairlineRowLink>
              </li>
            );
          })}
        </HairlineList>
      </Section>

      <Section
        titulo="Membros"
        acao={
          <span className="font-display text-[11px] font-bold tracking-[.08em] text-fg-4 uppercase">
            {membros.length} {membros.length === 1 ? "pessoa" : "pessoas"}
          </span>
        }
      >
        <HairlineList as="ul">
          {membros.map((m) => (
            <HairlineRow as="li" key={m.playerId}>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-display text-[14px] font-bold text-fg">
                  {m.nickname ?? m.name}
                </span>
                {m.nickname && (
                  <span className="block truncate text-[11.5px] text-fg-4">{m.name}</span>
                )}
              </span>
              {!m.temConta && <Badge tom="dashed">sem conta</Badge>}
              {m.papel !== "member" && <Badge tom="accent">{papelLabel[m.papel]}</Badge>}
            </HairlineRow>
          ))}
        </HairlineList>
      </Section>
    </div>
  );
}
