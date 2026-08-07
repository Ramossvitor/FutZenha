import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq, inArray } from "drizzle-orm";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { LinkButton, SubmitButton } from "@/components/ui/button";
import { Card, CardHeader, Eyebrow, PageHeader, Section } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { HairlineList, HairlineRow } from "@/components/ui/hairline-list";
import { IconeCadeado, IconeLuva } from "@/components/ui/icons";
import { Nota } from "@/components/ui/nota";
import { VestChip } from "@/components/ui/vest";
import { db } from "@/db";
import {
  attendances,
  gamePlayers,
  games,
  goals,
  matchDays,
  players,
  teamPlayers,
  teams,
} from "@/db/schema";
import { formatDate, formatSkill, formatTime } from "@/lib/format";
import { getGrupo, papelNoGrupo } from "@/lib/grupos";
import { STATUS_PELADA } from "@/lib/match-day-form";
import { podeGerenciarPelada } from "@/lib/permissions";
import { getSession } from "@/lib/session";
import { setMyAttendance } from "./actions";

export default async function PeladaPage({ params }: PageProps<"/pelada/[id]">) {
  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id)) notFound();

  const session = await getSession();
  const [matchDay] = await db.select().from(matchDays).where(eq(matchDays.id, id));
  if (!matchDay) notFound();

  const activePlayers = await db
    .select()
    .from(players)
    .where(eq(players.active, true))
    .orderBy(asc(players.name));
  const attendanceRows = await db.select().from(attendances).where(eq(attendances.matchDayId, id));
  const statusByPlayer = new Map(attendanceRows.map((a) => [a.playerId, a.status]));
  const confirmados = attendanceRows.filter((a) => a.status === "in").length;

  const teamList = await db
    .select()
    .from(teams)
    .where(eq(teams.matchDayId, id))
    .orderBy(asc(teams.sortOrder));
  const teamMembers =
    teamList.length > 0
      ? await db
          .select({
            teamId: teamPlayers.teamId,
            playerId: players.id,
            name: players.name,
            nickname: players.nickname,
            skill: players.skill,
            isGoalkeeper: players.isGoalkeeper,
          })
          .from(teamPlayers)
          .innerJoin(players, eq(teamPlayers.playerId, players.id))
          .where(
            inArray(
              teamPlayers.teamId,
              teamList.map((t) => t.id),
            ),
          )
          .orderBy(asc(players.name))
      : [];

  const gameList = await db
    .select()
    .from(games)
    .where(eq(games.matchDayId, id))
    .orderBy(asc(games.sortOrder), asc(games.id));
  const goalRows =
    gameList.length > 0
      ? await db
          .select({
            gameId: goals.gameId,
            quantity: goals.quantity,
            playerId: players.id,
            playerName: players.name,
            nickname: players.nickname,
          })
          .from(goals)
          .innerJoin(players, eq(goals.playerId, players.id))
          .where(
            inArray(
              goals.gameId,
              gameList.map((g) => g.id),
            ),
          )
      : [];
  // De que lado cada um jogou, POR JOGO. Não dá para sair do team_players do
  // sorteio como saía antes: incluirNoJogo põe alguém do lado oposto sem tocar
  // no colete da pelada, e quem chegou atrasado e foi escalado direto num jogo
  // nem tem linha de sorteio — o gol dele saía com o chip cinza de colete
  // desconhecido. game_players é a fonte que o resto do app já trata como
  // autoridade sobre escalação (ver gerenciar/dados.ts e encerrar/page.tsx).
  const escalacao =
    gameList.length > 0
      ? await db
          .select({
            gameId: gamePlayers.gameId,
            playerId: gamePlayers.playerId,
            side: gamePlayers.side,
          })
          .from(gamePlayers)
          .where(
            inArray(
              gamePlayers.gameId,
              gameList.map((g) => g.id),
            ),
          )
      : [];
  const nomeDoTime = new Map(teamList.map((t) => [t.id, t.name]));
  const jogoPorId = new Map(gameList.map((g) => [g.id, g]));
  // Chave `jogo:jogador` porque a mesma pessoa pode trocar de lado entre jogos.
  // Quem marcou gol sem linha de escalação fica de fora do mapa e cai no colete
  // neutro do VestChip — melhor um chip cinza honesto do que chutar um lado.
  const timeNoJogo = new Map(
    escalacao.map((e) => {
      const jogo = jogoPorId.get(e.gameId);
      const teamId = e.side === "A" ? jogo?.teamAId : jogo?.teamBId;
      const nome = teamId === undefined ? undefined : nomeDoTime.get(teamId);
      return [`${e.gameId}:${e.playerId}`, nome ?? ""];
    }),
  );

  const podeMarcar = matchDay.status === "scheduled";
  const meuPlayerId = session?.player.id ?? null;

  // Em pelada de grupo, o admin do grupo também gerencia — e o papel sai do
  // groupId da própria pelada, nunca de um id vindo da URL.
  const papel =
    session && matchDay.groupId !== null
      ? await papelNoGrupo(matchDay.groupId, session.player.id)
      : null;
  const grupo = matchDay.groupId !== null ? await getGrupo(matchDay.groupId) : undefined;
  const podeGerenciar =
    session !== null &&
    podeGerenciarPelada(
      { playerId: session.player.id, isPlatformAdmin: session.isPlatformAdmin },
      matchDay,
      papel,
    );

  // Grupo privado não vira link para quem está de fora: o 404 do guard não
  // adianta nada se a própria pelada anuncia o nome e o id do grupo.
  const grupoVisivel = grupo && (grupo.visibility === "public" || papel !== null);

  return (
    <div className="flex flex-col gap-7">
      <PageHeader
        titulo={formatDate(matchDay.date)}
        selos={
          <>
            <Badge tom={matchDay.status === "finished" ? "neutral" : "accent"}>
              {STATUS_PELADA[matchDay.status]}
            </Badge>
            {grupoVisivel && (
              <Link href={`/grupo/${grupo.id}`}>
                <Badge tom="outline">{grupo.name}</Badge>
              </Link>
            )}
          </>
        }
        descricao={
          <>
            {formatTime(matchDay.startTime) && <>{formatTime(matchDay.startTime)} · </>}
            {matchDay.location}
            {matchDay.notes && (
              <span className="mt-1 block text-fg-4">{matchDay.notes}</span>
            )}
          </>
        }
        acao={
          podeGerenciar ? (
            <LinkButton href={`/pelada/${matchDay.id}/gerenciar`} variante="secondary" tamanho="sm">
              Gerenciar
            </LinkButton>
          ) : undefined
        }
      />

      {teamList.length > 0 && (
        <Section
          titulo="Times"
          acao={
            <span className="font-display text-[10px] font-bold tracking-[.08em] text-fg-4 uppercase">
              sorteados pela nota
            </span>
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {teamList.map((team) => {
              const doTime = teamMembers.filter((m) => m.teamId === team.id);
              const soma = doTime.reduce((a, p) => a + p.skill, 0);
              return (
                <Card key={team.id}>
                  <CardHeader>
                    <VestChip time={team.name} tamanho="lg" />
                    <span className="flex-1 font-display text-[15px] font-extrabold font-stretch-112% text-fg">
                      {team.name}
                    </span>
                    {doTime.length > 0 && (
                      <span className="text-right">
                        <Eyebrow>soma · média</Eyebrow>
                        <span
                          className="block font-display text-[13px] font-bold text-fg-2"
                          data-num
                        >
                          {formatSkill(soma)} · {formatSkill(soma / doTime.length)}
                        </span>
                      </span>
                    )}
                  </CardHeader>
                  <ul className="flex flex-col">
                    {doTime.map((m) => (
                      <li
                        key={m.playerId}
                        className="flex items-center gap-2 border-b border-line-soft px-4 py-2 last:border-0"
                      >
                        {m.isGoalkeeper && (
                          <span title="goleiro">
                            <IconeLuva className="size-4 shrink-0 text-warn-ink" />
                            <span className="sr-only">goleiro</span>
                          </span>
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-display text-[14px] font-bold text-fg">
                            {m.nickname ?? m.name}
                          </span>
                          {m.nickname && (
                            <span className="block truncate text-[11.5px] text-fg-4">{m.name}</span>
                          )}
                        </span>
                        {m.playerId === meuPlayerId && <Badge tom="accent">você</Badge>}
                        <Nota valor={m.skill} tamanho="sm" />
                      </li>
                    ))}
                  </ul>
                </Card>
              );
            })}
          </div>
        </Section>
      )}

      <Section titulo="Jogos">
        {gameList.length === 0 ? (
          <EmptyState
            titulo="Nenhuma bola rolou ainda"
            descricao="Os placares aparecem aqui conforme quem organiza vai lançando."
          />
        ) : (
          <div className="flex flex-col gap-2.5">
            {gameList.map((game) => {
              const gols = goalRows.filter((g) => g.gameId === game.id);
              const timeA = nomeDoTime.get(game.teamAId) ?? "";
              const timeB = nomeDoTime.get(game.teamBId) ?? "";
              return (
                <Card key={game.id} className="p-3.5">
                  <div className="flex items-center gap-3">
                    <span className="flex flex-1 items-center justify-end gap-2">
                      <span className="truncate font-display text-[12px] font-bold text-fg-2">
                        {timeA}
                      </span>
                      <VestChip time={timeA} />
                    </span>
                    <span
                      className="font-display text-[26px] leading-none font-black font-stretch-125% text-fg"
                      data-num
                    >
                      {game.scoreA} × {game.scoreB}
                    </span>
                    <span className="flex flex-1 items-center gap-2">
                      <VestChip time={timeB} />
                      <span className="truncate font-display text-[12px] font-bold text-fg-2">
                        {timeB}
                      </span>
                    </span>
                  </div>

                  {gols.length > 0 && (
                    <ul className="mt-3 flex flex-col gap-1.5 border-t border-line-soft pt-2.5">
                      {gols.map((g, i) => (
                        <li key={i} className="flex items-center gap-2">
                          {/* A cor é a do colete do lado em que a pessoa jogou
                              NESTE jogo — é o que permite ler de relance para
                              que lado foi o gol. */}
                          <VestChip
                            time={timeNoJogo.get(`${game.id}:${g.playerId}`) ?? ""}
                            tamanho="sm"
                          />
                          <span className="flex-1 truncate text-[12.5px] text-fg-2">
                            {g.nickname ?? g.playerName}
                          </span>
                          <span
                            className="font-display text-[12px] font-extrabold text-fg"
                            data-num
                          >
                            {g.quantity}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </Section>

      <Section
        titulo="Presença"
        acao={
          <span className="flex items-baseline gap-1">
            <span
              className="font-display text-[18px] leading-none font-black font-stretch-125% text-fg"
              data-num
            >
              {confirmados}
            </span>
            <span className="font-display text-[11px] font-bold text-fg-4">
              / {activePlayers.length}
            </span>
          </span>
        }
      >
        {matchDay.status === "teams_drawn" && (
          <Banner tom="info">
            <IconeCadeado className="mr-1.5 inline size-4 align-text-bottom" />
            Times já sorteados — a presença travou. Fala com quem organiza.
          </Banner>
        )}
        {matchDay.status === "finished" && <Banner tom="info">Pelada encerrada.</Banner>}
        {podeMarcar && !session && (
          <Banner tom="info">
            <Link
              href={`/login?next=/pelada/${matchDay.id}`}
              className="font-semibold text-accent-ink hover:underline"
            >
              Entre na sua conta
            </Link>{" "}
            para marcar presença.
          </Banner>
        )}

        <HairlineList as="ul">
          {activePlayers.map((player) => {
            const status = statusByPlayer.get(player.id);
            const souEu = meuPlayerId === player.id;
            return (
              <HairlineRow
                as="li"
                key={player.id}
                destaque={souEu}
                apagado={status === "out"}
              >
                {/* A marca colorida repete o que o selo à direita já diz — cor
                    sozinha não pode carregar a informação. */}
                <span
                  aria-hidden
                  className={`h-6 w-1 shrink-0 rounded-full ${
                    status === "in"
                      ? "bg-accent"
                      : status === "out"
                        ? "bg-danger"
                        : "bg-line-strong"
                  }`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-display text-[14px] font-bold text-fg">
                    {player.nickname ?? player.name}
                  </span>
                  {player.nickname && (
                    <span className="block truncate text-[11.5px] text-fg-4">{player.name}</span>
                  )}
                </span>

                {souEu && <Badge tom="accent">você</Badge>}
                {status === "in" && <Badge tom="accent">vai</Badge>}
                {status === "out" && <Badge tom="neutral">fora</Badge>}

                {podeMarcar && souEu && (
                  <span className="ml-auto flex gap-1.5">
                    {status !== "in" && (
                      <form action={setMyAttendance.bind(null, matchDay.id, "in")}>
                        <SubmitButton tamanho="sm">Vou</SubmitButton>
                      </form>
                    )}
                    {status !== "out" && (
                      <form action={setMyAttendance.bind(null, matchDay.id, "out")}>
                        <SubmitButton variante="secondary" tamanho="sm">
                          Fora
                        </SubmitButton>
                      </form>
                    )}
                  </span>
                )}
              </HairlineRow>
            );
          })}
        </HairlineList>

        <p className="text-[11.5px] text-fg-4">
          Não está na lista ou não tem conta? Fala com quem organiza a pelada.
        </p>
      </Section>
    </div>
  );
}
