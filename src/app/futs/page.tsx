import { desc, asc, inArray, eq } from "drizzle-orm";
import {
  pedirParaEntrarNoFut,
  responderConviteDeFut,
} from "@/app/fut/[id]/entrada-actions";
import { Badge } from "@/components/ui/badge";
import { BannerDaQuery } from "@/components/ui/banner";
import { LinkButton, SubmitButton } from "@/components/ui/button";
import { Card, PageHeader, Section } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { HairlineList, HairlineRowLink } from "@/components/ui/hairline-list";
import { VestChip } from "@/components/ui/vest";
import { db } from "@/db";
import { games, groups, matchDays, teams } from "@/db/schema";
import { convitesDeFutPendentes, futsParaExplorar } from "@/lib/fut-entrada-db";
import { formatDate, formatDateShort, formatHorario, formatTime } from "@/lib/format";
import { getGrupoAtual } from "@/lib/grupo-atual";
import { listarMeusGrupos } from "@/lib/grupos";
import { STATUS_FUT } from "@/lib/match-day-form";
import { podeGerenciarFut } from "@/lib/permissions";
import { getSession } from "@/lib/session";

export const metadata = { title: "Futs" };
export const dynamic = "force-dynamic";

export default async function FutsPage({ searchParams }: PageProps<"/futs">) {
  const { ok, erro } = await searchParams;
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
  // "você gerencia" precisa do papel (`podeGerenciarFut` quer o papel no
  // grupo Daquele fut), e o nome do grupo precisa só da associação.
  const meuPapelPorGrupo = new Map(
    session ? (await listarMeusGrupos(session.player.id)).map((g) => [g.id, g.papel]) : [],
  );

  // Esta página é PÚBLICA (não está no matcher de src/proxy.ts), então o nome do
  // grupo passa pelo mesmo teste que a página do fut faz: grupo privado não
  // anuncia o nome para quem está de fora. Sem isso, o 404 do guard não protege
  // nada — bastava abrir /futs deslogado para ler o nome de todo grupo
  // privado com fut marcado.
  const groupIds = [...new Set(days.map((d) => d.groupId).filter((g) => g !== null))];
  const groupRows = groupIds.length
    ? await db
        .select({ id: groups.id, name: groups.name, visibility: groups.visibility })
        .from(groups)
        .where(inArray(groups.id, groupIds))
    : [];
  // As duas listas da entrada por consentimento (ver src/lib/fut-entrada.ts).
  // Só para quem está logado: convite é pessoal, e explorar exige saber quem
  // pergunta (a lista traz "já estou" e "já pedi" por jogador).
  const [convitesDeFut, paraExplorar] = session
    ? await Promise.all([
        convitesDeFutPendentes(session.player.id),
        futsParaExplorar(session.player.id),
      ])
    : [[], []];

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
        titulo="Futs"
        descricao={grupo ? "Só as deste grupo." : "De todos os grupos, mais as avulsas."}
        acao={
          session ? (
            <LinkButton href="/futs/novo" variante="primary" tamanho="sm">
              Marcar fut
            </LinkButton>
          ) : undefined
        }
      />

      <BannerDaQuery ok={ok} erro={erro} />

      {/* Quem chamou você. Convite NÃO é presença: a lista só muda quando você
          responde — é o ponto do desenho em src/lib/fut-entrada.ts. */}
      {convitesDeFut.length > 0 && (
        <Section titulo="Chamaram você">
          <div className="flex flex-col gap-2">
            {convitesDeFut.map((c) => (
              <Card key={c.id} className="border-warn-line bg-warn-tint p-4">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-display text-[16px] font-extrabold font-stretch-112% text-fg">
                      {formatDate(c.date)} · {c.location}
                    </p>
                    <p className="text-[13px] leading-[1.45] text-fg-2">
                      {c.convidadoPor ? `Convite de ${c.convidadoPor}` : "Você foi chamado"}
                      {formatHorario(c.startTime, c.endTime)
                        ? ` · ${formatHorario(c.startTime, c.endTime)}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <form action={responderConviteDeFut.bind(null, c.matchDayId, c.id, true)}>
                      <SubmitButton tamanho="sm">Vou</SubmitButton>
                    </form>
                    <form action={responderConviteDeFut.bind(null, c.matchDayId, c.id, false)}>
                      <SubmitButton variante="secondary" tamanho="sm">
                        Não vou
                      </SubmitButton>
                    </form>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </Section>
      )}

      {/* Explorar: só fut AVULSO e só `scheduled` — fut de grupo é do grupo, e
          listá-lo aqui entregaria data, local e organizador de fut de grupo
          privado a quem não é membro. A trava está na consulta
          (futsParaExplorar), não nesta tela. */}
      {paraExplorar.length > 0 && (
        <Section
          titulo="Explorar"
          acao={<span className="eyebrow">futs avulsos abertos</span>}
        >
          <div className="flex flex-col gap-2">
            {paraExplorar.map((f) => (
              <Card key={f.id} className="p-4">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-display text-[16px] font-extrabold font-stretch-112% text-fg">
                      {formatDateShort(f.date)} · {f.location}
                    </p>
                    <p className="text-[13px] leading-[1.45] text-fg-2">
                      {f.organizador ? `Marcado por ${f.organizador}` : "Sem organizador"}
                      {" · "}
                      {f.confirmados}
                      {f.maxPlayers !== null ? `/${f.maxPlayers}` : ""} na lista
                    </p>
                  </div>
                  {f.jaPedi ? (
                    <Badge tom="dashed">pedido enviado</Badge>
                  ) : (
                    <form action={pedirParaEntrarNoFut.bind(null, f.id)}>
                      <SubmitButton variante="secondary" tamanho="sm">
                        Pedir para entrar
                      </SubmitButton>
                    </form>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </Section>
      )}

      <HairlineList
        as="ul"
        vazio={
          <EmptyState
            titulo="Nenhum fut por aqui"
            descricao={
              grupo
                ? "Ninguém marcou nada neste grupo ainda."
                : "Quando alguém marcar a primeira, ela aparece aqui."
            }
            acao={
              session ? (
                <LinkButton href="/futs/novo" variante="primary" tamanho="sm">
                  Marcar fut
                </LinkButton>
              ) : undefined
            }
          />
        }
      >
        {days.map((day) => {
          const dayGames = gameRows.filter((g) => g.matchDayId === day.id);
          const papel = day.groupId !== null ? (meuPapelPorGrupo.get(day.groupId) ?? null) : null;
          const euGerencio = ator !== null && podeGerenciarFut(ator, day, papel);
          const nomeGrupo = day.groupId !== null ? nomeDoGrupo.get(day.groupId) : undefined;

          return (
            <li key={day.id}>
              <HairlineRowLink href={`/fut/${day.id}`} className="items-start">
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
                      {STATUS_FUT[day.status]}
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
