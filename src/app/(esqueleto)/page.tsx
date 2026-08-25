import Link from "next/link";
import { and, asc, desc, eq, gte, inArray, ne } from "drizzle-orm";
import { setMyAttendance } from "@/app/(esqueleto)/fut/[id]/actions";
import { votar } from "@/app/(esqueleto)/votacao/[id]/actions";
import { AvatarPilha } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { LinkButton, SubmitButton } from "@/components/ui/button";
import { Card, Section, SectionLink } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { HairlineList, HairlineRowLink } from "@/components/ui/hairline-list";
import { IconeAlerta, IconeSeta } from "@/components/ui/icons";
import { BarraDaVotacao } from "@/components/ui/meter";
import { Podium } from "@/components/ui/podium";
import { Prazo } from "@/components/ui/prazo";
import { VestChip } from "@/components/ui/vest";
import { VotarForm } from "@/components/ui/votar-form";
import { db } from "@/db";
import { attendances, games, matchDays, players, teams } from "@/db/schema";
import { getVotacoesAbertasDoJogador } from "@/lib/deletion";
import { ehElegivel } from "@/lib/elegiveis";
import { formatDateShort, formatTime, todayISO } from "@/lib/format";
import { getGrupoAtual } from "@/lib/grupo-atual";
import { podeMexerNoProprioNome } from "@/lib/lista-presenca";
import { STATUS_FUT } from "@/lib/match-day-form";
import { posicoes } from "@/lib/posicao";
import { getRodadasAbertasDoJogador } from "@/lib/ratings";
import { getSession } from "@/lib/session";
import { getTopScorers } from "@/lib/stats";

export const dynamic = "force-dynamic";

const DIA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** O bloco de data do design: dia da semana, número grande, mês. */
function BlocoDeData({ data }: { data: string }) {
  // Meio-dia pelo mesmo motivo do format.ts: `date` do Postgres não tem fuso, e
  // meia-noite desliza um dia para trás em fuso negativo.
  const d = new Date(`${data}T12:00:00`);
  return (
    <div className="flex shrink-0 flex-col items-center rounded-ctl border border-line bg-surface-2 px-3 py-2">
      <span className="font-display text-[10px] font-extrabold tracking-[.12em] text-accent-ink uppercase">
        {DIA[d.getDay()]}
      </span>
      <span
        className="font-display text-[30px] leading-none font-black font-stretch-125% text-fg"
        data-num
      >
        {String(d.getDate()).padStart(2, "0")}
      </span>
      <span className="font-display text-[10px] font-bold tracking-[.1em] text-fg-4 uppercase">
        {MES[d.getMonth()]}
      </span>
    </div>
  );
}

export default async function HomePage() {
  const session = await getSession();
  const grupo = await getGrupoAtual();
  const escopoDoGrupo = grupo ? eq(matchDays.groupId, grupo.id) : undefined;

  const [nextMatch] = await db
    .select()
    .from(matchDays)
    .where(
      and(gte(matchDays.date, todayISO()), ne(matchDays.status, "finished"), escopoDoGrupo),
    )
    .orderBy(asc(matchDays.date), asc(matchDays.id))
    .limit(1);

  const presencas = nextMatch
    ? await db
        .select({ status: attendances.status, name: players.name, nickname: players.nickname, playerId: players.id })
        .from(attendances)
        .innerJoin(players, eq(attendances.playerId, players.id))
        .where(eq(attendances.matchDayId, nextMatch.id))
    : [];
  const confirmados = presencas.filter((p) => p.status === "in");
  const naEspera = presencas.filter((p) => p.status === "waitlist");
  // Mesma regra da página do fut: com "Todos os futs" no seletor, a
  // próxima pode ser de um grupo que não é meu — e aí o botão não é meu.
  const souElegivel =
    session && nextMatch ? await ehElegivel(nextMatch, session.player.id) : false;
  const minhaPresenca = session
    ? presencas.find((p) => p.playerId === session.player.id)?.status
    : undefined;
  // `recusou: false` fixo, e não uma consulta: o desfazer de quem já disse não
  // é caso raro e mora na página do fut, que é para onde o e-mail e o push
  // apontam. Perguntar aqui custaria um round-trip a mais na home para todo
  // mundo, e o preço de não perguntar é um botão a menos num cartão de resumo.
  // `nextMatch` nunca é encerrado, então `sair` é sempre verdadeiro.
  const podeMexer = nextMatch
    ? podeMexerNoProprioNome(nextMatch.status, { recusou: false })
    : { entrar: false, sair: false };

  const recentDays = await db
    .select()
    .from(matchDays)
    .where(and(eq(matchDays.status, "finished"), escopoDoGrupo))
    .orderBy(desc(matchDays.date), desc(matchDays.id))
    .limit(3);
  const ids = recentDays.map((d) => d.id);
  const [recentGames, teamRows] = ids.length
    ? await Promise.all([
        db.select().from(games).where(inArray(games.matchDayId, ids)).orderBy(asc(games.sortOrder)),
        db.select().from(teams).where(inArray(teams.matchDayId, ids)),
      ])
    : [[], []];
  const nomeDoTime = new Map(teamRows.map((t) => [t.id, t.name]));

  const artilheiros = (await getTopScorers({ groupId: grupo?.id })).slice(0, 3);
  const posDoPodio = posicoes(artilheiros, (a) => a.total);

  // As pendências são pessoais e independem do grupo escolhido: uma avaliação
  // com prazo correndo não pode sumir da tela só porque a pessoa trocou de
  // contexto — é justamente o que ela não pode perder.
  const [rodadas, votacoes] = session
    ? await Promise.all([
        getRodadasAbertasDoJogador(session.player.id),
        getVotacoesAbertasDoJogador(session.player.id),
      ])
    : [[], []];
  const rodadaPendente = rodadas.find((r) => !r.jaEnviou);
  const votacaoPendente = votacoes.find((v) => !v.jaVotei && v.horasRestantes > 0);

  return (
    <div className="flex flex-col gap-7">
      {rodadaPendente && (
        <Link
          href={`/avaliar/${rodadaPendente.round.id}`}
          className="-mx-4 flex items-center gap-3 bg-accent px-4 py-3 text-on-accent transition-colors hover:bg-accent-hover lg:mx-0 lg:rounded-card"
        >
          <span className="min-w-0 flex-1">
            <span className="block font-display text-[16px] leading-[1.2] font-black font-stretch-112%">
              Avalia a rapaziada
            </span>
            <span className="block truncate font-display text-[11px] font-bold opacity-75">
              fut de {formatDateShort(rodadaPendente.matchDayDate)} · {rodadaPendente.location}
            </span>
          </span>
          <Prazo horas={rodadaPendente.horasRestantes} sobre="accent" />
          <IconeSeta className="size-5 shrink-0" />
        </Link>
      )}

      {votacaoPendente && (
        <Card className="border-danger-line bg-danger-tint p-4">
          <div className="flex items-start gap-2.5">
            <IconeAlerta className="mt-0.5 size-5 shrink-0 text-danger" />
            <div className="min-w-0 flex-1">
              <p className="font-display text-[15px] leading-[1.25] font-extrabold font-stretch-112% text-fg">
                Querem apagar o fut de {formatDateShort(votacaoPendente.matchDayDate)}
              </p>
              <p className="mt-1 text-[13px] leading-[1.45] text-fg-2">
                {votacaoPendente.reason}
              </p>
              <p className="mt-1 text-[13px] leading-[1.45] text-fg-2">
                Não votar conta como <strong className="text-fg">contra</strong>.
              </p>
            </div>
          </div>

          <div className="mt-3 flex flex-col gap-1.5">
            <BarraDaVotacao
              sim={votacaoPendente.placar.sim}
              nao={votacaoPendente.placar.nao}
              elegiveis={votacaoPendente.placar.elegiveis}
            />
            <div className="flex flex-wrap justify-between gap-x-3 font-display text-[10px] font-bold tracking-[.08em] uppercase">
              <span className="text-accent-ink">{votacaoPendente.placar.sim} a favor</span>
              <span className="text-danger-ink">{votacaoPendente.placar.nao} contra</span>
              <span className="text-fg-4">
                precisa de {votacaoPendente.placar.necessarios} de{" "}
                {votacaoPendente.placar.elegiveis}
              </span>
            </div>
          </div>

          <div className="mt-3">
            <VotarForm voteId={votacaoPendente.voteId} acaoVotar={votar} />
          </div>

          <div className="mt-2.5 flex items-center gap-2">
            <Prazo horas={votacaoPendente.horasRestantes} />
            <span className="text-[11.5px] text-fg-3">O voto é definitivo.</span>
          </div>
        </Card>
      )}

      <Section
        titulo="Próximo fut"
        acao={nextMatch ? <Badge tom="accent">{STATUS_FUT[nextMatch.status]}</Badge> : undefined}
      >
        {nextMatch ? (
          <Card>
            <Link href={`/fut/${nextMatch.id}`} className="block p-4 hover:bg-surface-2">
              <div className="flex items-start gap-3.5">
                <BlocoDeData data={nextMatch.date} />
                <div className="min-w-0 flex-1">
                  <p className="font-display text-[19px] leading-[1.15] font-extrabold font-stretch-112% text-fg">
                    {formatTime(nextMatch.startTime) && <>{formatTime(nextMatch.startTime)} · </>}
                    {nextMatch.location}
                  </p>
                  {nextMatch.notes && (
                    <p className="mt-1 text-[13px] leading-[1.45] text-fg-3">{nextMatch.notes}</p>
                  )}
                </div>
              </div>

              <div className="mt-4 flex items-center gap-2.5 border-t border-line pt-3.5">
                <span
                  className="font-display text-[24px] leading-none font-black font-stretch-125% text-fg"
                  data-num
                >
                  {confirmados.length}
                  {nextMatch.maxPlayers !== null && (
                    <span className="text-[15px] text-fg-4">/{nextMatch.maxPlayers}</span>
                  )}
                </span>
                <span className="font-display text-[11px] leading-[1.25] font-bold tracking-[.08em] text-fg-3 uppercase">
                  {nextMatch.maxPlayers === null
                    ? confirmados.length === 1
                      ? "confirmado"
                      : "confirmados"
                    : "vagas"}
                  {naEspera.length > 0 && ` · ${naEspera.length} na espera`}
                </span>
                <span className="flex-1" />
                <AvatarPilha nomes={confirmados.map((c) => c.nickname ?? c.name)} />
              </div>
            </Link>

            {/* ENTRAR só existe antes do sorteio; SAIR vale até o fut ser
                encerrado, e `nextMatch` nunca é encerrado. A assimetria é a
                mesma da página do fut: é depois do sorteio que quem organiza
                inclui quem quiser, e é aí que retirar o nome precisa existir.

                Depois do sorteio o rodapé só aparece para quem TEM presença.
                Sem isto, um cartão de fut avulso já sorteado mostrava "Retirar
                meu nome" em largura cheia para toda conta ativa — `ehElegivel`
                não filtra ninguém em fut avulso —, oferecendo a saída de uma
                lista em que a pessoa nunca esteve. */}
            {session &&
              souElegivel &&
              podeMexer.sair &&
              (podeMexer.entrar || minhaPresenca !== undefined) && (
              <div className="flex border-t border-line">
                {podeMexer.entrar && (
                  <form action={setMyAttendance.bind(null, nextMatch.id, "in")} className="flex-1">
                    <SubmitButton
                      variante={
                        minhaPresenca === "in" || minhaPresenca === "waitlist" ? "primary" : "ghost"
                      }
                      // Só o "Vou". Sair da lista não é conquista de ninguém.
                      //
                      // `sobre-accent` porque aqui o botão SOBREVIVE à action, e
                      // a bola pousa em cima dele — que ao voltar já é o lime
                      // cheio de quem está na lista. E é justamente por
                      // sobreviver que ele precisa dizer o que a action muda: sem
                      // o `festejaQuando`, clicar com a lista recém-fechada pelo
                      // sorteio comemorava uma entrada que não houve.
                      festeja="sobre-accent"
                      festejaQuando={minhaPresenca ?? "fora"}
                      tamanho="lg"
                      className="w-full rounded-none rounded-bl-card border-0 border-r border-line"
                    >
                      {/* O botão diz o que vai acontecer, não o que a pessoa
                          gostaria: clicar "Vou" num fut lotado põe na espera,
                          e descobrir isso só depois é a pior versão disto. */}
                      {minhaPresenca === "waitlist"
                        ? "Na espera"
                        : nextMatch.maxPlayers !== null &&
                            confirmados.length >= nextMatch.maxPlayers &&
                            minhaPresenca !== "in"
                          ? "Entrar na espera"
                          : "Vou"}
                    </SubmitButton>
                  </form>
                )}
                <form action={setMyAttendance.bind(null, nextMatch.id, "out")} className="flex-1">
                  <SubmitButton
                    variante={minhaPresenca === "out" ? "danger" : "ghost"}
                    tamanho="lg"
                    // Sozinho no rodapé do cartão (lista já sorteada), arredonda
                    // os dois cantos de baixo — senão sobra um canto reto onde
                    // não há vizinho.
                    className={`w-full rounded-none border-0 ${podeMexer.entrar ? "rounded-br-card" : "rounded-b-card"}`}
                  >
                    {podeMexer.entrar ? "Fora" : "Retirar meu nome"}
                  </SubmitButton>
                </form>
              </div>
            )}

            {!session && nextMatch.status === "scheduled" && (
              <div className="border-t border-line px-4 py-3">
                <Link
                  href={`/login?next=/fut/${nextMatch.id}`}
                  className="text-[13px] font-semibold text-accent-ink hover:underline"
                >
                  Entre na sua conta para confirmar presença
                </Link>
              </div>
            )}
          </Card>
        ) : (
          <EmptyState
            titulo="Nenhum fut marcado"
            descricao={
              grupo
                ? "Ninguém marcou nada neste grupo ainda."
                : "Ninguém marcou nada ainda. Quem organiza é quem marca."
            }
            acao={
              session ? (
                <LinkButton href="/futs/novo" variante="primary" tamanho="sm">
                  Marcar fut
                </LinkButton>
              ) : undefined
            }
          />
        )}
      </Section>

      {recentDays.length > 0 && (
        <Section titulo="Últimos resultados" acao={<SectionLink href="/futs">Ver todas</SectionLink>}>
          <HairlineList as="ul">
            {recentDays.map((day) => {
              const dayGames = recentGames.filter((g) => g.matchDayId === day.id);
              return (
                <li key={day.id}>
                  <HairlineRowLink href={`/fut/${day.id}`} className="items-start">
                    <span className="w-11 shrink-0 pt-0.5 font-display text-[11px] font-bold text-fg-4">
                      {formatDateShort(day.date).slice(0, 5)}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      {dayGames.length === 0 && (
                        <span className="text-[13px] text-fg-4">sem jogo lançado</span>
                      )}
                      {dayGames.map((g) => (
                        <span key={g.id} className="flex items-center gap-1.5">
                          <VestChip time={nomeDoTime.get(g.teamAId) ?? ""} tamanho="sm" />
                          <span
                            className="font-display text-[14px] font-extrabold font-stretch-112% text-fg"
                            data-num
                          >
                            {g.scoreA} × {g.scoreB}
                          </span>
                          <VestChip time={nomeDoTime.get(g.teamBId) ?? ""} tamanho="sm" />
                          <span className="truncate text-[12px] text-fg-4">
                            {nomeDoTime.get(g.teamAId)} × {nomeDoTime.get(g.teamBId)}
                          </span>
                        </span>
                      ))}
                    </span>
                  </HairlineRowLink>
                </li>
              );
            })}
          </HairlineList>
        </Section>
      )}

      {artilheiros.length > 0 && (
        <Section
          titulo="Pódio da artilharia"
          acao={<SectionLink href="/rankings?aba=artilharia">Ranking</SectionLink>}
        >
          <Podium
            itens={artilheiros.map((a, i) => ({
              posicao: posDoPodio[i],
              nome: a.nickname ?? a.name,
              valor: a.total,
            }))}
          />
        </Section>
      )}

      {grupo && (
        <p className="text-center text-[12px] text-fg-4">
          Você está vendo <strong className="text-fg-3">{grupo.name}</strong>.{" "}
          <Link href="/grupos" className="text-accent-ink hover:underline">
            Trocar de grupo
          </Link>
        </p>
      )}

      <p className="text-center text-[12px] text-fg-4">
        Primeira vez por aqui?{" "}
        <Link href="/guia" className="text-accent-ink hover:underline">
          Leia o guia
        </Link>
        .
      </p>
    </div>
  );
}
