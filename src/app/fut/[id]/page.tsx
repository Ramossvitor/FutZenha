import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { CartaoDeJogo } from "@/components/fut/resumo-do-fut";
import { Badge } from "@/components/ui/badge";
import { Banner, BannerDaQuery } from "@/components/ui/banner";
import { BotoesDeAgenda } from "@/components/ui/botoes-de-agenda";
import { LinkButton, SubmitButton } from "@/components/ui/button";
import { Card, CardHeader, Eyebrow, PageHeader, Section } from "@/components/ui/card";
import { ConfeteDoSorteio } from "@/components/ui/confete-do-sorteio";
import { EmptyState } from "@/components/ui/empty-state";
import { HairlineList, HairlineRow } from "@/components/ui/hairline-list";
import { IconeCadeado, IconeLuva } from "@/components/ui/icons";
import { assinarPush, cancelarPush } from "@/app/pwa/actions";
import { PedidoDePush } from "@/components/push/pedido-de-push";
import { LinkJogador } from "@/components/ui/nome-jogador";
import { Nota } from "@/components/ui/nota";
import { VestChip } from "@/components/ui/vest";
import { WhatsAppShareButton } from "@/components/ui/whatsapp-share-button";
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
import { jogadoresElegiveis } from "@/lib/elegiveis";
import { comoEntraNoFut } from "@/lib/fut-entrada";
import { estaNoCirculoDoFut, temPedidoPendenteNoFut } from "@/lib/fut-entrada-db";
import { cancelarPedidoDeFut, pedirParaEntrarNoFut } from "./entrada-actions";
import { formatDate, formatHorario, formatSkill } from "@/lib/format";
import { getMvpDoFut } from "@/lib/ratings";
import { getGrupo, papelNoGrupo } from "@/lib/grupos";
import { podeMexerNoProprioNome, repartirLista, vagasLivres } from "@/lib/lista-presenca";
import { STATUS_FUT } from "@/lib/match-day-form";
import { podeGerenciarFut, podeOperarSumula } from "@/lib/permissions";
import { montarResumo } from "@/lib/resumo";
import { recusouEsteFut } from "@/lib/presenca";
import { temSumulaDelegada } from "@/lib/require-operador-sumula";
import { sumulaDisponivel } from "@/lib/sumula";
import { getSession } from "@/lib/session";
import { siteUrl } from "@/lib/site-url";
import { textoDeConvocacao, textoDeTimes } from "@/lib/whatsapp";
import { setMyAttendance } from "./actions";

type LinhaExibida = { playerId: number; status: "in" | "out" | "waitlist" | "no_show" };

/**
 * Um pedaço da lista — na lista, na espera, faltou, não respondeu.
 *
 * A numeração é o que faz a lista parecer lista: "você é o 3º da espera" é a
 * informação que a pessoa procura, e ela não existe numa chamada alfabética.
 */
function Bloco({
  titulo,
  legenda,
  linhas,
  jogadorPorId,
  meuPlayerId,
  numerada = false,
  apagar = true,
}: {
  titulo: string;
  legenda?: string;
  linhas: LinhaExibida[];
  jogadorPorId: Map<number, { id: number; name: string; nickname: string | null }>;
  meuPlayerId: number | null;
  numerada?: boolean;
  apagar?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Eyebrow>
        {titulo} · {linhas.length}
      </Eyebrow>
      {legenda && <p className="text-[11.5px] text-fg-4">{legenda}</p>}
      <HairlineList as="ul">
        {linhas.map((linha, i) => {
          const jogador = jogadorPorId.get(linha.playerId);
          if (!jogador) return null;
          const souEu = meuPlayerId === linha.playerId;
          const inativo = apagar && (linha.status === "out" || linha.status === "no_show");
          return (
            <HairlineRow as="li" key={linha.playerId} destaque={souEu} apagado={inativo}>
              {numerada ? (
                <span
                  className="w-5 shrink-0 text-right font-display text-[12px] font-bold text-fg-4"
                  data-num
                >
                  {i + 1}
                </span>
              ) : (
                /* A marca colorida repete o que o selo à direita já diz — cor
                   sozinha não pode carregar a informação. */
                <span
                  aria-hidden
                  className={`h-6 w-1 shrink-0 rounded-full ${
                    linha.status === "no_show" ? "bg-danger" : "bg-line-strong"
                  }`}
                />
              )}
              <LinkJogador
                playerId={jogador.id}
                apelido={jogador.nickname}
                nome={jogador.name}
              />

              {souEu && <Badge tom="accent">você</Badge>}
              {linha.status === "waitlist" && <Badge tom="neutral">espera</Badge>}
              {linha.status === "no_show" && <Badge tom="neutral">faltou</Badge>}
            </HairlineRow>
          );
        })}
      </HairlineList>
    </div>
  );
}

export default async function FutPage({ params, searchParams }: PageProps<"/fut/[id]">) {
  const [{ id: idParam }, { ok, erro }] = await Promise.all([params, searchParams]);
  const id = Number(idParam);
  if (!Number.isInteger(id)) notFound();

  // Três ondas de Promise.all em vez de uma escadinha de awaits: era a página
  // mais lenta do app — até 10 round-trips seriais ao banco por navegação.
  const [session, [matchDay]] = await Promise.all([
    getSession(),
    db.select().from(matchDays).where(eq(matchDays.id, id)),
  ]);
  if (!matchDay) notFound();

  const meuPlayerId = session?.player.id ?? null;

  const [activePlayers, attendanceRows, teamList, gameList, papel, noCirculo, recusei] =
    await Promise.all([
      // Fut de grupo lista o grupo. Avulso lista só quem o organizador pode
      // marcar de fato — sem conta, já no fut, ou ele mesmo —, que é o espelho de
      // podeDefinirPresencaPor: oferecer mais seria enfileirar botões que só
      // devolvem "precisa-confirmar". Ver src/lib/elegiveis.ts.
      jogadoresElegiveis(matchDay, session?.player.id),
      db.select().from(attendances).where(eq(attendances.matchDayId, id)),
      db.select().from(teams).where(eq(teams.matchDayId, id)).orderBy(asc(teams.sortOrder)),
      db.select().from(games).where(eq(games.matchDayId, id)).orderBy(asc(games.sortOrder), asc(games.id)),
      // Em fut de grupo, o admin do grupo também gerencia — e o papel sai do
      // groupId do próprio fut, nunca de um id vindo da URL.
      session && matchDay.groupId !== null
        ? papelNoGrupo(matchDay.groupId, session.player.id)
        : null,
      // Nesta onda, e não num await solto lá embaixo: só depende do fut e de
      // quem pergunta, os dois já resolvidos — e esta é a página pública mais
      // quente do app.
      meuPlayerId === null ? false : estaNoCirculoDoFut(matchDay, meuPlayerId),
      // Pelo mesmo motivo, e é o mesmo par de argumentos. Tentador pendurar num
      // `||` depois de olhar `optedOutAt` na linha que já veio — só que o
      // curto-circuito pouparia a consulta exatamente de quem JÁ recusou, o
      // caso raro, e todo visitante normal pagaria o round-trip em série.
      meuPlayerId === null ? false : recusouEsteFut(id, meuPlayerId),
    ]);
  const statusByPlayer = new Map(attendanceRows.map((a) => [a.playerId, a.status]));
  const jogadorPorId = new Map(activePlayers.map((p) => [p.id, p]));
  // Quem tem linha mas não está elegível é jogador desativado: some da lista,
  // como sempre somiu.
  const { vagas, espera, faltas } = repartirLista(
    attendanceRows.filter((a) => jogadorPorId.has(a.playerId)),
  );
  const semResposta = activePlayers.filter((p) => !statusByPlayer.has(p.id));
  const confirmados = vagas.length;
  const livres = vagasLivres(confirmados, matchDay.maxPlayers);
  const listaCheia = livres === 0;

  const [teamMembers, goalRows, escalacao, grupo, minhaDelegacao, mvps] = await Promise.all([
    teamList.length > 0
      ? db
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
      : [],
    gameList.length > 0
      ? db
          .select({
            gameId: goals.gameId,
            quantity: goals.quantity,
            // leftJoin: gol sem autor (gol contra / ninguém viu, lançado pela
            // súmula ao vivo) tem player_id nulo e ainda assim é gol — o
            // `side` gravado diz de que lado saiu. Gol desfeito no painel é
            // soft-delete e fica de fora.
            playerId: players.id,
            playerName: players.name,
            nickname: players.nickname,
            side: goals.side,
          })
          .from(goals)
          .leftJoin(players, eq(goals.playerId, players.id))
          .where(
            and(
              inArray(
                goals.gameId,
                gameList.map((g) => g.id),
              ),
              isNull(goals.desfeitoEm),
            ),
          )
      : [],
    // De que lado cada um jogou, POR JOGO. Não dá para sair do team_players do
    // sorteio como saía antes: incluirNoJogo põe alguém do lado oposto sem tocar
    // no colete do fut, e quem chegou atrasado e foi escalado direto num jogo
    // nem tem linha de sorteio — o gol dele saía com o chip cinza de colete
    // desconhecido. game_players é a fonte que o resto do app já trata como
    // autoridade sobre escalação (ver gerenciar/dados.ts e encerrar/page.tsx).
    gameList.length > 0
      ? db
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
      : [],
    matchDay.groupId !== null ? getGrupo(matchDay.groupId) : undefined,
    // Delegado da súmula ao vivo: precisa achar o caminho do painel a partir
    // daqui, porque o /gerenciar continua sendo 404 para ele. A resposta vem do
    // MESMO helper que o guard usa, senão o link apareceria para quem o painel
    // recusa.
    session ? temSumulaDelegada(id, session.player.id) : false,
    // Vazio enquanto a rodada de avaliação corre — o título só existe apurado.
    matchDay.status === "finished" ? getMvpDoFut(id) : [],
  ]);
  // Placar, gols e o colete de cada gol saem do módulo puro, com os dados que
  // esta página já carregou — nenhuma consulta a mais. O mesmo montarResumo
  // alimenta a tela de avaliação e o e-mail de encerramento, e é por isso que
  // ele existe: a regra do colete (escalação do jogo, com o `side` do gol de
  // reserva) tinha três candidatos a dono e nenhum era natural.
  const resumo = montarResumo({
    times: teamList,
    jogos: gameList,
    gols: goalRows,
    escalacao,
    elencos: teamMembers,
  });

  // A minha linha na lista, para a pergunta que só ela responde: quem me pôs
  // aqui (`confirmedByPlayerId`). A recusa não sai daqui — ela tem duas fontes,
  // e `recusouEsteFut` (na onda lá em cima) já leu as duas.
  const minhaLinha =
    meuPlayerId === null ? undefined : attendanceRows.find((a) => a.playerId === meuPlayerId);
  // Entrar e sair deixaram de ser a mesma pergunta: sair vale até o fut ser
  // encerrado (é DEPOIS do sorteio que o organizador inclui quem quiser, e é aí
  // que retirar o nome precisa existir), e quem recusou pode voltar mesmo com a
  // lista fechada. Ver podeMexerNoProprioNome.
  const podeMexer = podeMexerNoProprioNome(matchDay.status, { recusou: recusei });
  const podeMarcar = matchDay.status === "scheduled";
  // Quem me pôs na lista, quando não fui eu — é o que dispara o aviso de
  // "confirmaram você" e o botão de retirar o nome.
  //
  // Consulta própria, e não `jogadorPorId`: aquele mapa vem de
  // `jogadoresElegiveis`, e quem confirmou não está necessariamente lá — em fut
  // avulso a lista de elegíveis é quase só o próprio visitante. Preguiçosa, como
  // o `jaPediu` logo abaixo: a coluna é nula na esmagadora maioria das linhas.
  const [confirmador] =
    minhaLinha?.confirmedByPlayerId == null
      ? []
      : await db
          .select({ nome: players.name, apelido: players.nickname })
          .from(players)
          .where(eq(players.id, minhaLinha.confirmedByPlayerId));
  const quemMeConfirmou = confirmador ? (confirmador.apelido ?? confirmador.nome) : null;
  // Num fut de grupo, quem não é do grupo não entra na lista — o servidor já
  // recusa (ver setMyAttendance). Sem este teste a tela oferecia o botão assim
  // mesmo, e clicar não fazia nada: sem erro, sem banner, sem explicação.
  const souElegivel = meuPlayerId !== null && activePlayers.some((p) => p.id === meuPlayerId);
  // O caminho de consentimento do fut avulso (ver src/lib/fut-entrada.ts):
  // quem nunca esteve nesta lista pede, e quem organiza decide. Quem já tem
  // linha aqui — inclusive quem marcou "Fora" — segue no vaivém normal.
  const entrada =
    meuPlayerId === null
      ? null
      : comoEntraNoFut(matchDay, {
          jaEstaNaLista: statusByPlayer.has(meuPlayerId),
          elegivel: souElegivel,
          noCirculo,
        });
  const precisaPedir = entrada === "pede-entrada";
  // Este fica preguiçoso de propósito: só quem precisa pedir tem pedido a
  // conferir, e é o caso raro. Enfiá-lo na onda lá em cima custaria uma consulta
  // a cada renderização para todo mundo.
  const jaPediu =
    precisaPedir && meuPlayerId !== null
      ? await temPedidoPendenteNoFut(matchDay.id, meuPlayerId)
      : false;

  const podeGerenciar =
    session !== null &&
    podeGerenciarFut(
      { playerId: session.player.id, isPlatformAdmin: session.isPlatformAdmin },
      matchDay,
      papel,
    );

  // Grupo privado não vira link para quem está de fora: o 404 do guard não
  // adianta nada se o próprio fut anuncia o nome e o id do grupo.
  const grupoVisivel = grupo && (grupo.visibility === "public" || papel !== null);

  // A súmula pede times sorteados (antes não há lado para creditar gol) e
  // aparece para quem opera. As duas regras vêm de onde o guard e a página do
  // painel também as leem — src/lib/sumula.ts e src/lib/permissions.ts.
  const podeOperarSumulaAqui =
    sumulaDisponivel(matchDay) &&
    session !== null &&
    podeOperarSumula(
      { playerId: session.player.id, isPlatformAdmin: session.isPlatformAdmin },
      matchDay,
      papel,
      minhaDelegacao,
    );

  return (
    <div className="flex flex-col gap-7">
      <PageHeader
        titulo={formatDate(matchDay.date)}
        selos={
          <>
            <Badge tom={matchDay.status === "finished" ? "neutral" : "accent"}>
              {STATUS_FUT[matchDay.status]}
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
            {formatHorario(matchDay.startTime, matchDay.endTime) && (
              <>{formatHorario(matchDay.startTime, matchDay.endTime)} · </>
            )}
            {matchDay.location}
            {matchDay.notes && (
              <span className="mt-1 block text-fg-4">{matchDay.notes}</span>
            )}
          </>
        }
        acao={
          podeGerenciar || podeOperarSumulaAqui ? (
            <span className="flex flex-wrap gap-1.5">
              {podeOperarSumulaAqui && (
                <LinkButton href={`/fut/${matchDay.id}/sumula`} tamanho="sm">
                  Súmula ao vivo
                </LinkButton>
              )}
              {podeGerenciar && (
                <LinkButton
                  href={`/fut/${matchDay.id}/gerenciar`}
                  variante="secondary"
                  tamanho="sm"
                >
                  Gerenciar
                </LinkButton>
              )}
            </span>
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
          <ConfeteDoSorteio
            chave={String(matchDay.id)}
            times={teamList.map((t) => t.name)}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            {teamList.map((team, i) => {
              const doTime = teamMembers.filter((m) => m.teamId === team.id);
              const soma = doTime.reduce((a, p) => a + p.skill, 0);
              return (
                <Card
                  key={team.id}
                  // Os times saem um de cada vez, como quem lê a lista em voz
                  // alta. Teto no 4º: com 2 a 4 times isto nunca chega a pesar,
                  // mas a regra vale para toda cascata do app — a última só pode
                  // esperar pela quarta, senão a lista vira fila de espera.
                  className="animate-chegada"
                  style={{ animationDelay: `${Math.min(i, 3) * 70}ms` }}
                >
                  <CardHeader>
                    <VestChip time={team.name} tamanho="lg" className="animate-pulo" />
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
                        <LinkJogador playerId={m.playerId} apelido={m.nickname} nome={m.name} />
                        {m.playerId === meuPlayerId && <Badge tom="accent">você</Badge>}
                        <Nota valor={m.skill} tamanho="sm" />
                      </li>
                    ))}
                  </ul>
                </Card>
              );
            })}
          </div>
          {/* O sorteio hoje é anunciado colando no grupo — o botão só poupa a
              digitação. Deslogado não vê: `souElegivel` e `podeGerenciar` já
              exigem sessão, então testá-la de novo aqui não mudaria nada. */}
          {(souElegivel || podeGerenciar) && (
            <WhatsAppShareButton
              texto={textoDeTimes(
                matchDay,
                teamList.map((t) => ({
                  nome: t.name,
                  jogadores: teamMembers
                    .filter((m) => m.teamId === t.id)
                    .map((m) => m.nickname ?? m.name),
                })),
              )}
              rotulo="Compartilhar os times"
              className="self-start"
            />
          )}
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
            {/* O MESMO cartão da tela de avaliação. A página mostra só ele
                daqui: artilharia ela não tem, e a seção de times é a dela, com
                nota e ações que o resumo compartilhado não carrega. */}
            {resumo.jogos.map((jogo) => (
              <CartaoDeJogo key={jogo.id} jogo={jogo} />
            ))}
          </div>
        )}
      </Section>

      {mvps.length > 0 && (
        <Section
          titulo="Melhor em campo"
          acao={
            mvps.length > 1 ? (
              <span className="font-display text-[10px] font-bold tracking-[.08em] text-fg-4 uppercase">
                título dividido
              </span>
            ) : undefined
          }
        >
          <HairlineList as="ul">
            {mvps.map((m) => (
              <HairlineRow as="li" key={m.playerId} destaque={m.playerId === meuPlayerId}>
                <LinkJogador playerId={m.playerId} apelido={m.nickname} nome={m.name} />
                {m.playerId === meuPlayerId && <Badge tom="accent">você</Badge>}
                <Badge tom="warn">MVP</Badge>
              </HairlineRow>
            ))}
          </HairlineList>
          <p className="text-[11.5px] leading-[1.45] text-fg-4">
            Eleito pela rapaziada na avaliação pós-fut. Empate de votos é decidido pela média de
            estrelas da rodada.
          </p>
        </Section>
      )}

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
              {matchDay.maxPlayers === null
                ? `/ ${activePlayers.length}`
                : `/ ${matchDay.maxPlayers} vagas`}
            </span>
          </span>
        }
      >
        {/* Os três caminhos de entrada (src/app/fut/[id]/entrada-actions.ts) e o
            `precisa-pedir-entrada` do setMyAttendance redirecionam para cá com
            `?ok=` / `?erro=`. Sem este banner a pessoa clicava, a página voltava
            igual e nada explicava o que houve — o mesmo silêncio que o teste de
            cobertura de slugs (src/lib/mensagens.test.ts) existe para evitar, e
            que ele não pega sozinho: ele confere que o slug TEM texto, não que
            a tela o mostra. */}
        <BannerDaQuery ok={ok} erro={erro} />
        {matchDay.status === "teams_drawn" && (
          <Banner tom="info">
            <IconeCadeado className="mr-1.5 inline size-4 align-text-bottom" />
            Times já sorteados — a presença travou. Fala com quem organiza.
          </Banner>
        )}
        {matchDay.status === "finished" && <Banner tom="info">Fut encerrado.</Banner>}
        {podeMarcar && !session && (
          <Banner tom="info">
            <Link
              href={`/login?next=/fut/${matchDay.id}`}
              className="font-semibold text-accent-ink hover:underline"
            >
              Entre na sua conta
            </Link>{" "}
            para marcar presença.
          </Banner>
        )}

        {/* A ordem importa: a lista é por ordem de chegada, e é isso que ela
            precisa mostrar. Antes era uma chamada alfabética de todo jogador da
            plataforma, em que o estado de cada um era um selo perdido no meio. */}
        {vagas.length > 0 && (
          <Bloco
            titulo="Na lista"
            linhas={vagas}
            jogadorPorId={jogadorPorId}
            meuPlayerId={meuPlayerId}
            numerada
          />
        )}

        {espera.length > 0 && (
          <Bloco
            titulo="Lista de espera"
            legenda={
              podeMarcar
                ? "Sobem por ordem de chegada assim que alguém sai."
                : "A lista fechou antes de abrir vaga."
            }
            linhas={espera}
            jogadorPorId={jogadorPorId}
            meuPlayerId={meuPlayerId}
            numerada
          />
        )}

        {faltas.length > 0 && (
          <Bloco
            titulo="Não compareceram"
            legenda="Confirmaram e não entraram em nenhum jogo — não conta presença."
            linhas={faltas}
            jogadorPorId={jogadorPorId}
            meuPlayerId={meuPlayerId}
          />
        )}

        {vagas.length === 0 && espera.length === 0 && (
          <EmptyState titulo="Ninguém na lista ainda" descricao="Seja o primeiro a confirmar." />
        )}

        {/* Quem ainda não respondeu só aparece enquanto dá para responder: depois
            do sorteio, essa lista é ruído — quem não entrou, não entrou. */}
        {podeMarcar && semResposta.length > 0 && (
          <Bloco
            titulo="Ainda não responderam"
            legenda={
              listaCheia
                ? "A lista está cheia — quem confirmar agora entra na espera."
                : undefined
            }
            linhas={semResposta.map((p) => ({ playerId: p.id, status: "out" as const }))}
            jogadorPorId={jogadorPorId}
            meuPlayerId={meuPlayerId}
            apagar={false}
          />
        )}

        {podeMarcar && session && !souElegivel && (
          <Banner tom="info">
            Este fut é do grupo {grupoVisivel ? grupo.name : "que a marcou"} — só quem é do
            grupo entra na lista.
          </Banner>
        )}

        {/* Fut avulso de quem você não conhece: a entrada é por PEDIDO, e quem
            decide é quem organiza. É a outra metade do desenho — a primeira foi
            tirar de quem organiza o poder de marcar presença por você. */}
        {podeMarcar && session && precisaPedir && (
          <div className="flex flex-col gap-2">
            <Banner tom="info">
              Você ainda não jogou neste fut. Peça para entrar — quem organiza decide.
            </Banner>
            {jaPediu ? (
              <span className="flex gap-1.5">
                <Badge tom="dashed">pedido enviado</Badge>
                <form action={cancelarPedidoDeFut.bind(null, matchDay.id)}>
                  <SubmitButton variante="secondary" tamanho="sm">
                    Cancelar pedido
                  </SubmitButton>
                </form>
              </span>
            ) : (
              <form action={pedirParaEntrarNoFut.bind(null, matchDay.id)}>
                <SubmitButton tamanho="sm">Pedir para entrar</SubmitButton>
              </form>
            )}
          </div>
        )}

        {/* `!precisaPedir` não é redundante com `souElegivel`. Em fut avulso a
            lista de elegíveis inclui o próprio visitante (é o `eq(players.id,
            atorId)` de `condicaoMarcavel`, que existe para quem organiza poder
            se marcar), então `souElegivel` é sempre verdadeiro para quem está
            logado — e sem esta condição o estranho via o bloco "Peça para
            entrar" E o botão "Vou" ao mesmo tempo, com o "Vou" caindo em
            `?erro=precisa-pedir-entrada`. Dois caminhos oferecidos, um deles
            sem saída. */}
        {/* Confirmaram você. É o par do push e do e-mail que saíram no mesmo
            momento: os três dizem quem foi, que não há nada a fazer se estiver
            tudo certo, e por onde sair. Some no instante em que a pessoa
            confirma sozinha (o que zera `confirmed_by_player_id`) ou sai. */}
        {quemMeConfirmou !== null &&
          meuPlayerId !== null &&
          (statusByPlayer.get(meuPlayerId) === "in" ||
            statusByPlayer.get(meuPlayerId) === "waitlist") && (
            <div className="rounded-ctl border border-line bg-surface-2 px-3 py-2.5">
              <p className="text-[13px] leading-[1.45] text-fg-2">
                <strong className="font-semibold text-fg">
                  {quemMeConfirmou} confirmou você neste fut.
                </strong>{" "}
                Se estiver tudo certo, não precisa fazer nada.
              </p>
              {podeMexer.sair && (
                <form
                  action={setMyAttendance.bind(null, matchDay.id, "out")}
                  className="mt-2.5"
                >
                  <SubmitButton variante="secondary" tamanho="sm">
                    Retirar meu nome
                  </SubmitButton>
                </form>
              )}
            </div>
          )}

        {/* O gate deixou de ser `podeMarcar` sozinho: sair vale depois do
            sorteio, e quem recusou pode voltar. Ver podeMexerNoProprioNome. */}
        {(podeMexer.entrar || podeMexer.sair) &&
          meuPlayerId !== null &&
          souElegivel &&
          !precisaPedir && (
            <span className="flex gap-1.5">
              {podeMexer.entrar &&
                statusByPlayer.get(meuPlayerId) !== "in" &&
                statusByPlayer.get(meuPlayerId) !== "waitlist" && (
                  <form action={setMyAttendance.bind(null, matchDay.id, "in")}>
                    {/* Este botão SOME quando a action dá certo — a condição
                        acima deixa de valer. É o caminho que a comemoração cobre
                        pela desmontagem, e não pelo pending caindo, e é por isso
                        que aqui não vai `festejaQuando`: a desmontagem já é a
                        prova, e a action que volta em silêncio devolve esta
                        mesma tela com o botão no lugar.

                        `padrao`, e não `sobre-accent`, justamente porque o botão
                        lime não está mais lá quando a bola é desenhada — ela cai
                        na surface da página. */}
                    <SubmitButton tamanho="sm" festeja="padrao">
                      {listaCheia ? "Entrar na espera" : "Vou"}
                    </SubmitButton>
                  </form>
                )}
              {/* Escondido quando o aviso acima já oferece "Retirar meu nome":
                  dois botões que fazem a mesma coisa, um do lado do outro, é a
                  tela perguntando duas vezes.

                  E, depois do sorteio, escondido de quem não tem linha nenhuma:
                  ali o botão sozinho não é mais o par do "Vou" — é uma saída
                  oferecida a quem nunca entrou. Com a lista aberta ele continua
                  aparecendo para todo mundo, que é como sempre foi: dizer "não
                  vou" antes de o organizador perguntar tem valor. */}
              {podeMexer.sair &&
                quemMeConfirmou === null &&
                (podeMexer.entrar || statusByPlayer.has(meuPlayerId)) &&
                statusByPlayer.get(meuPlayerId) !== "out" && (
                  <form action={setMyAttendance.bind(null, matchDay.id, "out")}>
                    <SubmitButton variante="secondary" tamanho="sm">
                      Fora
                    </SubmitButton>
                  </form>
                )}
            </span>
          )}

        {/* O momento em que o aviso tem valor óbvio: quem acabou de entrar na
            lista quer saber dos times; quem caiu na espera quer saber da vaga.
            O componente decide sozinho se pode pedir — ver pedido-de-push. */}
        {matchDay.status !== "finished" &&
          meuPlayerId !== null &&
          (statusByPlayer.get(meuPlayerId) === "in" ||
            statusByPlayer.get(meuPlayerId) === "waitlist") && (
            <PedidoDePush
              contexto={statusByPlayer.get(meuPlayerId) === "waitlist" ? "espera" : "confirmado"}
              acoes={{ aoAssinar: assinarPush, aoCancelar: cancelarPush }}
            />
          )}

        {/* O fut na agenda de quem vai — Google direto, Outlook, ou o .ics para
            Apple e o resto. O convite por e-mail entra sozinho ao confirmar;
            estes são o caminho manual (e o de quem olha sem confirmar). */}
        {matchDay.status !== "finished" && (
          <BotoesDeAgenda fut={matchDay} urlBase={siteUrl()} />
        )}

        {/* Convocação pronta para o grupo — enquanto a lista está aberta,
            qualquer um do fut pode chamar a galera, não só o admin. */}
        {podeMarcar && (souElegivel || podeGerenciar) && (
          <WhatsAppShareButton
            texto={textoDeConvocacao(matchDay, siteUrl())}
            rotulo="Convocar no WhatsApp"
            className="self-start"
          />
        )}

        <p className="text-[11.5px] text-fg-4">
          Não está na lista ou não tem conta? Fala com quem organiza o fut.
        </p>
      </Section>
    </div>
  );
}
