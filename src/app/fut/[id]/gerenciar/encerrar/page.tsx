import { notFound, redirect } from "next/navigation";
import { and, asc, eq, inArray } from "drizzle-orm";
import { Badge } from "@/components/ui/badge";
import { BannerDaQuery } from "@/components/ui/banner";
import { LinkButton, SubmitButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader, Eyebrow, PageHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { HairlineList, HairlineRow } from "@/components/ui/hairline-list";
import { IconeAlerta, IconeCheck, IconeLuva } from "@/components/ui/icons";
import { VestChip } from "@/components/ui/vest";
import { db } from "@/db";
import { attendances, gamePlayers, games, players, teams, users } from "@/db/schema";
import { cx } from "@/lib/cx";
import { condicaoElegivel } from "@/lib/elegiveis";
import { montarChecklist, quemViraFalta } from "@/lib/encerramento";
import { formatDate } from "@/lib/format";
import { companheirosPorJogador, gruposElegiveis } from "@/lib/lineup";
import { JANELA_CORRECAO_HORAS, PRAZO_AVALIACAO_HORAS } from "@/lib/regras";
import { requireFutAdmin } from "@/lib/require-fut-admin";
import { BuscaJogador, type ItemJogador } from "@/components/ui/busca-jogador";
import { confirmarEncerramento, incluirNoJogo, moverLado, removerDoJogo } from "./actions";

export const metadata = { title: "Conferir escalação" };

const LOCAIS = {
  "precisa-confirmar":
    "Quem tem conta ativa e ainda não entrou neste fut precisa marcar a própria presença antes de ser escalado.",
};

const SEM_ACESSO = <Badge tom="dashed">não avalia</Badge>;

export default async function EncerrarFutPage({
  params,
  searchParams,
}: PageProps<"/fut/[id]/gerenciar/encerrar">) {
  const { id: idParam } = await params;
  const { erro } = await searchParams;
  const id = Number(idParam);
  if (!Number.isInteger(id)) notFound();

  const { matchDay } = await requireFutAdmin(id);
  // Encerrado já não tem o que conferir — a escalação virou imutável.
  if (matchDay.status === "finished") redirect(`/fut/${id}/gerenciar`);

  const [gameList, teamList, elenco, confirmados] = await Promise.all([
    db
      .select()
      .from(games)
      .where(eq(games.matchDayId, id))
      .orderBy(asc(games.sortOrder), asc(games.id)),
    db.select().from(teams).where(eq(teams.matchDayId, id)).orderBy(asc(teams.sortOrder)),
    db
      .select({
        id: players.id,
        name: players.name,
        nickname: players.nickname,
        isGoalkeeper: players.isGoalkeeper,
        userId: users.id,
      })
      .from(players)
      // A mesma condição do getRatersElegiveis: conta desativada não avalia nem
      // é avaliada. Sem o users.active aqui, o checklist contava a conta
      // desativada como ativa e prometia uma rodada que o servidor não abre.
      .leftJoin(users, and(eq(users.playerId, players.id), eq(users.active, true)))
      // O mesmo escopo das outras duas telas de presença: fut de grupo lista
      // o grupo, não a plataforma — e o incluirNoJogo recusa quem está fora dele.
      .where(and(eq(players.active, true), condicaoElegivel(matchDay)))
      .orderBy(asc(players.name)),
    db
      .select({ playerId: attendances.playerId })
      .from(attendances)
      .where(and(eq(attendances.matchDayId, id), eq(attendances.status, "in"))),
  ]);

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

  const jogadorPorId = new Map(elenco.map((p) => [p.id, p]));
  const nomeDoTime = new Map(teamList.map((t) => [t.id, t.name]));

  // O checklist usa as mesmas funções puras que decidem quem avalia quem, então
  // o que ele promete é o que vai acontecer de fato no encerramento.
  const comConta = new Set(elenco.filter((p) => p.userId !== null).map((p) => p.id));
  const avaliaveis = gruposElegiveis(companheirosPorJogador(escalacao), comConta);
  const escalados = new Set(escalacao.map((e) => e.playerId));
  const escaladosComConta = [...escalados].filter((pid) => comConta.has(pid));
  const escaladosSemConta = [...escalados]
    .filter((pid) => !comConta.has(pid))
    .map((pid) => jogadorPorId.get(pid)?.nickname ?? jogadorPorId.get(pid)?.name ?? "alguém");

  // Quem confirmou e não entrou em nenhum jogo vira falta no encerramento (ver
  // marcarFaltasAutomaticas). Mostrar antes é o que torna isso corrigível: depois
  // do encerramento a escalação é imutável, e a única forma de consertar seria
  // apagar o fut. A regra vem do quemViraFalta para a prévia e o servidor não
  // poderem divergir.
  const viraFalta = quemViraFalta({
    temJogo: gameList.length > 0,
    confirmados: confirmados.map((a) => a.playerId),
    escalados,
  })
    .map((playerId) => jogadorPorId.get(playerId))
    .filter((p) => p !== undefined);

  const checklist = montarChecklist({
    // TODOS os jogos, inclusive os sem nenhuma linha de escalação: são
    // justamente eles que travam o encerramento no servidor.
    jogos: gameList.map((g, i) => ({
      ordem: i + 1,
      ladoA: escalacao.filter((e) => e.gameId === g.id && e.side === "A").length,
      ladoB: escalacao.filter((e) => e.gameId === g.id && e.side === "B").length,
    })),
    avaliaveis: avaliaveis.size,
    comContaEmCampo: escaladosComConta.length,
    semConta: escaladosSemConta,
  });

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8">
      <div className="flex min-w-0 flex-1 flex-col gap-6">
        <PageHeader
          titulo="Conferir escalação e encerrar"
          selos={<Badge tom="warn">{formatDate(matchDay.date)}</Badge>}
          descricao="Última chance de acertar quem jogou de que lado. Depois de encerrar, a escalação não muda mais — e é ela que define quem avalia quem."
          acao={
            <LinkButton href={`/fut/${id}/gerenciar`} variante="secondary" tamanho="sm">
              Voltar
            </LinkButton>
          }
        />

        <BannerDaQuery erro={erro} locais={LOCAIS} />

        {gameList.length === 0 && (
          <EmptyState
            titulo="Nenhum jogo lançado"
            descricao="Dá para encerrar assim, mas não haverá avaliação — não há escalação para dizer quem jogou com quem."
          />
        )}

        {gameList.map((game, i) => {
          const doJogo = escalacao.filter((e) => e.gameId === game.id);
          const fora = elenco.filter((p) => !doJogo.some((e) => e.playerId === p.id));
          const lado = (side: "A" | "B") =>
            doJogo
              .filter((e) => e.side === side)
              .map((e) => jogadorPorId.get(e.playerId))
              .filter((p) => p !== undefined)
              .sort((a, b) => a.name.localeCompare(b.name));

          return (
            <Card key={game.id}>
              <CardHeader>
                <Eyebrow>jogo {i + 1}</Eyebrow>
                <span className="flex flex-1 items-center gap-2">
                  <VestChip time={nomeDoTime.get(game.teamAId) ?? ""} tamanho="sm" />
                  <span className="font-display text-[13px] font-bold text-fg-2">
                    {nomeDoTime.get(game.teamAId)}
                  </span>
                  <span className="font-display text-[15px] font-black text-fg" data-num>
                    {game.scoreA} × {game.scoreB}
                  </span>
                  <VestChip time={nomeDoTime.get(game.teamBId) ?? ""} tamanho="sm" />
                  <span className="font-display text-[13px] font-bold text-fg-2">
                    {nomeDoTime.get(game.teamBId)}
                  </span>
                </span>
              </CardHeader>

              {/* Dois lados lado a lado no desktop, empilhados no celular — é a
                  tela que mais ganha com largura. */}
              <div className="grid sm:grid-cols-2">
                {(["A", "B"] as const).map((side) => {
                  const membros = lado(side);
                  const nome = nomeDoTime.get(side === "A" ? game.teamAId : game.teamBId) ?? "";
                  return (
                    <div
                      key={side}
                      className={cx(
                        "flex flex-col gap-2 p-4",
                        side === "A" && "sm:border-r sm:border-line",
                      )}
                    >
                      <div className="flex items-center gap-2 border-b border-line-soft pb-2">
                        <VestChip time={nome} />
                        <span className="flex-1 font-display text-[15px] font-extrabold font-stretch-112% text-fg">
                          {nome}
                        </span>
                        <span className="font-display text-[11px] font-bold text-fg-4">
                          {membros.length} em campo
                        </span>
                      </div>

                      {membros.length === 0 ? (
                        <p className="flex items-center gap-1.5 text-[13px] font-semibold text-danger-ink">
                          <IconeAlerta className="size-4" />
                          Nenhum jogador deste lado.
                        </p>
                      ) : (
                        <ul className="flex flex-col gap-1">
                          {membros.map((p) => (
                            <li key={p.id} className="flex items-center gap-2 py-1">
                              {p.isGoalkeeper && (
                                <span title="goleiro">
                                  <IconeLuva className="size-4 shrink-0 text-warn-ink" />
                                  <span className="sr-only">goleiro</span>
                                </span>
                              )}
                              <span className="min-w-0 flex-1 truncate font-display text-[14px] font-bold text-fg">
                                {p.nickname ?? p.name}
                              </span>
                              {!p.userId && SEM_ACESSO}
                              <span className="flex shrink-0 gap-1">
                                <form action={moverLado.bind(null, id, game.id, p.id)}>
                                  <SubmitButton
                                    variante="secondary"
                                    tamanho="sm"
                                    title="Trocar de lado"
                                  >
                                    {side === "A" ? "Mover →" : "← Mover"}
                                  </SubmitButton>
                                </form>
                                <form action={removerDoJogo.bind(null, id, game.id, p.id)}>
                                  <SubmitButton
                                    variante="danger-outline"
                                    tamanho="sm"
                                    title="Não jogou esta partida"
                                  >
                                    Não jogou
                                  </SubmitButton>
                                </form>
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>

              <details className="border-t border-line">
                <summary className="cursor-pointer px-4 py-3 font-display text-[12px] font-bold tracking-[.06em] text-accent-ink uppercase">
                  + Incluir alguém neste jogo ({fora.length} fora)
                </summary>
                <div className="flex flex-col gap-2 px-4 pb-4">
                  <p className="text-[12px] text-fg-4">
                    Escalar aqui marca a presença do jogador no fut automaticamente.
                  </p>
                  <BuscaJogador
                    vazio="Todo o elenco já está escalado neste jogo."
                    itens={fora.map(
                      (p): ItemJogador => ({
                        id: p.id,
                        nome: p.name,
                        apelido: p.nickname,
                        selos: p.userId ? undefined : SEM_ACESSO,
                        acoes: (
                          <>
                            {(["A", "B"] as const).map((side) => (
                              <form
                                key={side}
                                action={incluirNoJogo.bind(null, id, game.id, side, p.id)}
                              >
                                <SubmitButton variante="secondary" tamanho="sm">
                                  +{" "}
                                  {nomeDoTime.get(side === "A" ? game.teamAId : game.teamBId)}
                                </SubmitButton>
                              </form>
                            ))}
                          </>
                        ),
                      }),
                    )}
                  />
                </div>
              </details>
            </Card>
          );
        })}
      </div>

      {/* Trilho fixo no desktop; no celular vira o fim da página. Nada de
          hairline em volta: `sticky` não funciona dentro de overflow-hidden. */}
      <aside className="flex w-full flex-col gap-4 lg:sticky lg:top-6 lg:w-[20rem] lg:shrink-0">
        <div>
          <Eyebrow>antes de encerrar</Eyebrow>
          <HairlineList as="ul" className="mt-2">
            {checklist.itens.map((item) => (
              <HairlineRow as="li" key={item.chave} className="items-start">
                <span
                  className={cx(
                    "mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-selo border",
                    item.tom === "ok" && "border-accent-line bg-accent-tint text-accent-ink",
                    item.tom === "alerta" && "border-danger-line bg-danger-tint text-danger-ink",
                    item.tom === "neutro" && "border-line bg-surface-2 text-fg-4",
                  )}
                >
                  {item.tom === "ok" ? (
                    <IconeCheck className="size-3" />
                  ) : item.tom === "alerta" ? (
                    <IconeAlerta className="size-3" />
                  ) : (
                    <span aria-hidden className="size-1 rounded-full bg-current" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={cx(
                      "block font-display text-[13.5px] leading-[1.3] font-bold",
                      item.tom === "alerta" ? "text-danger-ink" : "text-fg",
                    )}
                  >
                    {item.titulo}
                  </span>
                  <span className="mt-0.5 block text-[11.5px] leading-[1.4] text-fg-4">
                    {item.detalhe}
                  </span>
                </span>
              </HairlineRow>
            ))}
          </HairlineList>
        </div>

        {viraFalta.length > 0 && (
          <div>
            <Eyebrow>vão contar falta</Eyebrow>
            <p className="mt-1 text-[11.5px] leading-[1.4] text-fg-4">
              Confirmaram e não entraram em nenhum jogo. Ao encerrar, não contam presença no
              ranking. Se algum deles jogou, inclua na escalação ao lado antes de confirmar.
            </p>
            <HairlineList as="ul" className="mt-2">
              {viraFalta.map((p) => (
                <HairlineRow as="li" key={p.id}>
                  <span className="min-w-0 flex-1 truncate font-display text-[13.5px] font-bold text-fg">
                    {p.nickname ?? p.name}
                  </span>
                  <Badge tom="neutral">não veio</Badge>
                </HairlineRow>
              ))}
            </HairlineList>
          </div>
        )}

        <Card className="border-danger-line bg-danger-tint">
          <CardBody className="flex flex-col gap-2">
            <span className="flex items-center gap-2">
              <IconeAlerta className="size-5 shrink-0 text-danger" />
              <span className="font-display text-[14.5px] font-black font-stretch-112% tracking-[.02em] text-danger-ink uppercase">
                Porta de mão única
              </span>
            </span>
            <ul className="flex flex-col gap-1.5">
              {[
                "A escalação congela pra sempre. Quem jogou de que lado não muda mais.",
                "Os números entram nos rankings na hora.",
                `A rodada de avaliação abre e o relógio de ${PRAZO_AVALIACAO_HORAS} horas começa a correr.`,
                `Placar e gols ainda dão pra corrigir por ${JANELA_CORRECAO_HORAS}h. Depois disso, só apagando o fut — e aí precisa de votação.`,
              ].map((t) => (
                <li key={t} className="flex items-start gap-2">
                  <span aria-hidden className="mt-1.5 size-1 shrink-0 rounded-full bg-danger" />
                  <span className="text-[12.5px] leading-[1.45] text-fg-2">{t}</span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>

        <form action={confirmarEncerramento.bind(null, id)} className="flex flex-col gap-2">
          {/* Irreversível: um duplo clique atrapalhado não pode encerrar duas
              vezes enquanto a primeira ainda está a caminho. */}
          <SubmitButton
            variante="danger"
            tamanho="lg"
            labelPending="Encerrando…"
            disabled={!checklist.podeEncerrar}
            className="w-full"
          >
            Encerrar o fut
          </SubmitButton>
          {!checklist.podeEncerrar && (
            <p className="text-center text-[11.5px] leading-[1.45] text-danger-ink">
              Tem jogo com um lado vazio. Corrige acima para poder encerrar.
            </p>
          )}
          <p className="text-center text-[11.5px] leading-[1.45] text-fg-4">
            Ao encerrar, os números entram nos rankings e a rodada de avaliação abre para{" "}
            {avaliaveis.size} {avaliaveis.size === 1 ? "pessoa" : "pessoas"}.
          </p>
        </form>
      </aside>
    </div>
  );
}
