import { desc, asc, inArray, eq } from "drizzle-orm";
import { Badge } from "@/components/ui/badge";
import { BannerDaQuery } from "@/components/ui/banner";
import { LinkButton } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { HairlineList, HairlineRowLink } from "@/components/ui/hairline-list";
import { VestChip } from "@/components/ui/vest";
import { db } from "@/db";
import { games, groups, matchDays, teams } from "@/db/schema";
import { formatDate, formatDateShort, formatTime } from "@/lib/format";
import { getGrupoAtual } from "@/lib/grupo-atual";
import { listarMeusGrupos } from "@/lib/grupos";
import { STATUS_PELADA } from "@/lib/match-day-form";
import { podeGerenciarPelada } from "@/lib/permissions";
import { getSession } from "@/lib/session";

export const metadata = { title: "Peladas" };
export const dynamic = "force-dynamic";

export default async function PeladasPage({ searchParams }: PageProps<"/peladas">) {
  const { ok } = await searchParams;
  const session = await getSession();
  const grupo = await getGrupoAtual();
  const ator = session
    ? { playerId: session.player.id, isPlatformAdmin: session.isPlatformAdmin }
    : null;

  const days = await db
    .select()
    .from(matchDays)
    .where(grupo ? eq(matchDays.groupId, grupo.id) : undefined)
    .orderBy(desc(matchDays.date), desc(matchDays.id));
  const dayIds = days.map((d) => d.id);
  const [gameRows, teamRows] = dayIds.length
    ? await Promise.all([
        db
          .select()
          .from(games)
          .where(inArray(games.matchDayId, dayIds))
          .orderBy(asc(games.sortOrder), asc(games.id)),
        db.select().from(teams).where(inArray(teams.matchDayId, dayIds)),
      ])
    : [[], []];
  const nomeDoTime = new Map(teamRows.map((t) => [t.id, t.name]));

  // Meu papel em cada grupo de que participo. Serve os dois selos abaixo: o
  // "você gerencia" precisa do papel (`podeGerenciarPelada` quer o papel no
  // grupo DAQUELA pelada), e o nome do grupo precisa só da associação.
  const meuPapelPorGrupo = new Map(
    session ? (await listarMeusGrupos(session.player.id)).map((g) => [g.id, g.papel]) : [],
  );

  // Esta página é PÚBLICA (não está no matcher de src/proxy.ts), então o nome do
  // grupo passa pelo mesmo teste que a página da pelada faz: grupo privado não
  // anuncia o nome para quem está de fora. Sem isso, o 404 do guard não protege
  // nada — bastava abrir /peladas deslogado para ler o nome de todo grupo
  // privado com pelada marcada.
  const groupIds = [...new Set(days.map((d) => d.groupId).filter((g) => g !== null))];
  const groupRows = groupIds.length
    ? await db
        .select({ id: groups.id, name: groups.name, visibility: groups.visibility })
        .from(groups)
        .where(inArray(groups.id, groupIds))
    : [];
  const nomeDoGrupo = new Map(
    groupRows
      .filter(
        (g) => g.visibility === "public" || meuPapelPorGrupo.has(g.id) || session?.isPlatformAdmin,
      )
      .map((g) => [g.id, g.name]),
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        titulo="Peladas"
        descricao={grupo ? "Só as deste grupo." : "De todos os grupos, mais as avulsas."}
        acao={
          session ? (
            <LinkButton href="/peladas/nova" variante="primary" tamanho="sm">
              Marcar pelada
            </LinkButton>
          ) : undefined
        }
      />

      <BannerDaQuery ok={ok} />

      <HairlineList
        as="ul"
        vazio={
          <EmptyState
            titulo="Nenhuma pelada por aqui"
            descricao={
              grupo
                ? "Ninguém marcou nada neste grupo ainda."
                : "Quando alguém marcar a primeira, ela aparece aqui."
            }
            acao={
              session ? (
                <LinkButton href="/peladas/nova" variante="primary" tamanho="sm">
                  Marcar pelada
                </LinkButton>
              ) : undefined
            }
          />
        }
      >
        {days.map((day) => {
          const dayGames = gameRows.filter((g) => g.matchDayId === day.id);
          const papel = day.groupId !== null ? (meuPapelPorGrupo.get(day.groupId) ?? null) : null;
          const euGerencio = ator !== null && podeGerenciarPelada(ator, day, papel);
          const nomeGrupo = day.groupId !== null ? nomeDoGrupo.get(day.groupId) : undefined;

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
                    {nomeGrupo && <Badge tom="outline">{nomeGrupo}</Badge>}
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
                          <VestChip time={nomeDoTime.get(g.teamAId) ?? ""} tamanho="sm" />
                          <span
                            className="font-display text-[13px] font-extrabold font-stretch-112% text-fg-2"
                            data-num
                          >
                            {g.scoreA} × {g.scoreB}
                          </span>
                          <VestChip time={nomeDoTime.get(g.teamBId) ?? ""} tamanho="sm" />
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
    </div>
  );
}
