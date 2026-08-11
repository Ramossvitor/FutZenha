import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { LinkButton, SubmitButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader, Eyebrow, Section } from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Select } from "@/components/ui/field";
import { HairlineList, HairlineRow } from "@/components/ui/hairline-list";
import { IconeLuva } from "@/components/ui/icons";
import { Nota } from "@/components/ui/nota";
import { Prazo } from "@/components/ui/prazo";
import { VestChip } from "@/components/ui/vest";
import { formatSkill, formatTime } from "@/lib/format";
import { listaFechada } from "@/lib/lista-presenca";
import { emailConfigurado } from "@/lib/email-envio";
import { siteUrl } from "@/lib/site-url";
import { BuscaJogador, type ItemJogador } from "@/components/ui/busca-jogador";
import {
  abrirVotacaoExclusao,
  addGoal,
  convidarParaFut,
  createGame,
  definirPresenca,
  deleteGame,
  deleteGoal,
  deleteMatchDay,
  drawTeamsAction,
  marcarFalta,
  promoverDaEspera,
  reenviarConviteDoFut,
  swapPlayersAction,
  updateGameScore,
  updateMatchDay,
} from "./actions";
import type { PainelDoFut } from "./dados";

// As seções do painel moram aqui, e não na página, porque o arquivo passava de
// 760 linhas e qualquer mudança numa seção exigia rolar as outras cinco. As
// Server Actions e o contrato de ?erro= continuam exatamente os mesmos.

export function SecaoDados({ fut }: { fut: PainelDoFut }) {
  const { matchDay } = fut;
  return (
    <Section titulo="Dados do fut">
      <Card>
        <CardBody>
          <form
            action={updateMatchDay.bind(null, matchDay.id)}
            className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end"
          >
            <Field htmlFor="g-date" label="Data" obrigatorio className="sm:w-40">
              <Input id="g-date" name="date" type="date" required defaultValue={matchDay.date} />
            </Field>
            <Field htmlFor="g-time" label="Horário" className="sm:w-32">
              <Input
                id="g-time"
                name="startTime"
                type="time"
                defaultValue={formatTime(matchDay.startTime) ?? ""}
              />
            </Field>
            <Field htmlFor="g-local" label="Local" obrigatorio className="sm:min-w-48 sm:flex-1">
              <Input id="g-local" name="location" required defaultValue={matchDay.location} />
            </Field>
            <Field htmlFor="g-vagas" label="Vagas" className="sm:w-24" ajuda="Vazio = sem limite.">
              <Input
                id="g-vagas"
                name="maxPlayers"
                type="number"
                min={2}
                max={60}
                inputMode="numeric"
                defaultValue={matchDay.maxPlayers ?? ""}
              />
            </Field>
            <Field htmlFor="g-notes" label="Observações" className="sm:min-w-48 sm:flex-1">
              <Input id="g-notes" name="notes" defaultValue={matchDay.notes ?? ""} />
            </Field>
            <SubmitButton>Salvar</SubmitButton>
          </form>
        </CardBody>
      </Card>
    </Section>
  );
}

export function SecaoPresenca({ fut }: { fut: PainelDoFut }) {
  const { matchDay, activePlayers, jogadorPorId, lista, statusByPlayer, confirmed, convitesParaEntregar } =
    fut;
  const fechada = listaFechada(matchDay.status);
  const encerrada = matchDay.status === "finished";

  return (
    <Section
      titulo="Presença"
      acao={
        <span className="font-display text-[11px] font-bold tracking-[.08em] text-fg-4 uppercase">
          {confirmed.length} confirmados
          {matchDay.maxPlayers !== null && ` de ${matchDay.maxPlayers}`}
        </span>
      }
    >
      <p className="text-[12.5px] leading-[1.5] text-fg-4">
        {fechada ? (
          <>
            A lista fechou no sorteio. Agora você registra o que aconteceu: quem apareceu sem estar
            na lista, quem <strong className="text-fg-3">não veio</strong> e quem sobe da espera.
          </>
        ) : (
          <>
            Você marca por quem ainda não tem acesso. Quem já tem conta marca{" "}
            <strong className="text-fg-3">Vou</strong> pela página do fut — depois do sorteio
            você passa a poder incluir qualquer pessoa do grupo.
          </>
        )}
      </p>

      {/* A ordem de chegada é o que a lista tem de mais concreto, e ela não
          existe na busca — que é alfabética e serve para achar alguém. Por isso
          as duas coisas convivem: a lista mostra a fila, a busca resolve casos. */}
      {(lista.vagas.length > 0 || lista.espera.length > 0 || lista.faltas.length > 0) && (
        <Card>
          <ul className="flex flex-col">
            {[
              { chave: "vagas" as const, rotulo: "Na lista", linhas: lista.vagas },
              { chave: "espera" as const, rotulo: "Espera", linhas: lista.espera },
              { chave: "faltas" as const, rotulo: "Não vieram", linhas: lista.faltas },
            ]
              .filter((bloco) => bloco.linhas.length > 0)
              .map((bloco) => (
                <li key={bloco.chave}>
                  <div className="border-b border-line-soft bg-surface-2 px-4 py-1.5">
                    <Eyebrow>
                      {bloco.rotulo} · {bloco.linhas.length}
                    </Eyebrow>
                  </div>
                  <ul className="flex flex-col">
                    {bloco.linhas.map((linha, i) => {
                      const jogador = jogadorPorId.get(linha.playerId);
                      if (!jogador) return null;
                      return (
                        <li
                          key={linha.playerId}
                          className="flex flex-wrap items-center gap-2 border-b border-line-soft px-4 py-2 last:border-0"
                        >
                          <span
                            className="w-5 shrink-0 text-right font-display text-[12px] font-bold text-fg-4"
                            data-num
                          >
                            {i + 1}
                          </span>
                          <span className="min-w-0 flex-1 truncate font-display text-[14px] font-bold text-fg">
                            {jogador.nickname ?? jogador.name}
                          </span>
                          {!encerrada && bloco.chave === "espera" && (
                            <form
                              action={promoverDaEspera.bind(null, matchDay.id, linha.playerId)}
                            >
                              <SubmitButton tamanho="sm" disabled={!fechada}>
                                Subir
                              </SubmitButton>
                            </form>
                          )}
                          {!encerrada && fechada && bloco.chave === "vagas" && (
                            <form
                              action={marcarFalta.bind(null, matchDay.id, linha.playerId, true)}
                            >
                              <SubmitButton variante="secondary" tamanho="sm">
                                Não veio
                              </SubmitButton>
                            </form>
                          )}
                          {!encerrada && bloco.chave === "faltas" && (
                            <form
                              action={marcarFalta.bind(null, matchDay.id, linha.playerId, false)}
                            >
                              <SubmitButton variante="secondary" tamanho="sm">
                                Veio, sim
                              </SubmitButton>
                            </form>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
          </ul>
        </Card>
      )}

      <BuscaJogador
        itens={activePlayers.map((player): ItemJogador => {
          const status = statusByPlayer.get(player.id);
          return {
            id: player.id,
            nome: player.name,
            apelido: player.nickname,
            selos: (
              <>
                {status === "in" && <Badge tom="accent">vai</Badge>}
                {status === "waitlist" && <Badge tom="neutral">espera</Badge>}
                {status === "no_show" && <Badge tom="neutral">não veio</Badge>}
                {status === "out" && <Badge tom="neutral">fora</Badge>}
              </>
            ),
            acoes: (
              <>
                {status !== "in" && (
                  <form action={definirPresenca.bind(null, matchDay.id, player.id, "in")}>
                    <SubmitButton tamanho="sm">Vai</SubmitButton>
                  </form>
                )}
                {status !== "out" && (
                  <form action={definirPresenca.bind(null, matchDay.id, player.id, "out")}>
                    <SubmitButton variante="secondary" tamanho="sm">
                      Fora
                    </SubmitButton>
                  </form>
                )}
              </>
            ),
          };
        })}
      />

      {matchDay.status !== "finished" && (
        <Card>
          <CardHeader>
            <span className="font-display text-[14px] font-bold text-fg">Chegou gente nova?</span>
          </CardHeader>
          <CardBody>
            <form
              action={convidarParaFut.bind(null, matchDay.id)}
              className="flex flex-col gap-4"
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
                <Field htmlFor="novo-nome" label="Nome" obrigatorio className="flex-1">
                  <Input
                    id="novo-nome"
                    name="name"
                    required
                    maxLength={60}
                    placeholder="Nome do jogador"
                  />
                </Field>
                <Field
                  htmlFor="novo-email"
                  label="E-mail (conta Google)"
                  className="flex-1"
                  ajuda="Opcional."
                >
                  <Input
                    id="novo-email"
                    name="email"
                    type="email"
                    maxLength={160}
                    placeholder="fulano@gmail.com"
                  />
                </Field>
              </div>
              <label className="flex items-center gap-2 text-[13px] text-fg-2">
                <input
                  type="checkbox"
                  name="isGoalkeeper"
                  className="size-4 accent-[var(--accent)]"
                />
                É goleiro
              </label>
              <SubmitButton className="self-start">Cadastrar e confirmar</SubmitButton>
              <p className="text-[12px] leading-[1.45] text-fg-4">
                Cria o jogador, já marca a presença e gera o convite de acesso — o link aparece
                aqui embaixo para você mandar no zap.{" "}
                {emailConfigurado()
                  ? "Com o e-mail preenchido, o convite já sai por e-mail, a pessoa entra pelo Google e só aquela conta o resgata."
                  : "Com o e-mail preenchido, a pessoa entra pelo Google e só aquela conta resgata o convite."}
              </p>
            </form>
          </CardBody>
        </Card>
      )}

      {convitesParaEntregar.length > 0 && (
        <Card>
          <CardHeader>
            <span className="font-display text-[14px] font-bold text-fg">
              Convites para entregar
            </span>
          </CardHeader>
          {/* Só de quem ainda não tem conta: convite para quem já tem é
              redefinição de senha, e isso é da plataforma. */}
          <ul className="flex flex-col">
            {convitesParaEntregar.map((c) => (
              <li
                key={c.token}
                className="flex flex-wrap items-center gap-2 border-b border-line-soft px-4 py-3 last:border-0"
              >
                <span className="font-display text-[13px] font-bold text-fg">{c.name}</span>
                {c.emailSentAt && (
                  <Badge tom="neutral" caixa="normal">
                    e-mail enviado{" "}
                    {c.emailSentAt.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
                  </Badge>
                )}
                <code className="min-w-0 flex-1 truncate rounded-selo bg-surface-2 px-2 py-1 text-[11px] text-fg-3">
                  {`${siteUrl()}/convite/${c.token}`}
                </code>
                <CopyButton text={`${siteUrl()}/convite/${c.token}`} />
                {/* Reenviar usa o mesmo token — um link já copiado segue valendo.
                    Sem key do Resend (preview, dev) o botão some. */}
                {c.email && emailConfigurado() && (
                  <form action={reenviarConviteDoFut.bind(null, matchDay.id, c.playerId)}>
                    <SubmitButton variante="secondary" tamanho="sm">
                      Reenviar e-mail
                    </SubmitButton>
                  </form>
                )}
                <span className="text-[11px] text-fg-4">
                  expira{" "}
                  {c.expiresAt.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </Section>
  );
}

export function SecaoTimes({ fut }: { fut: PainelDoFut }) {
  const { matchDay, teamList, teamMembers, confirmed, gameList } = fut;

  return (
    <Section titulo="Times">
      {matchDay.status !== "finished" && (
        <Card>
          <CardBody>
            <form
              action={drawTeamsAction.bind(null, matchDay.id)}
              className="flex flex-wrap items-end gap-3"
            >
              <Field htmlFor="teamCount" label="Nº de times" className="w-28">
                <Select
                  id="teamCount"
                  name="teamCount"
                  defaultValue={confirmed.length >= 15 ? 3 : 2}
                >
                  <option value={2}>2</option>
                  <option value={3}>3</option>
                  <option value={4}>4</option>
                </Select>
              </Field>
              {/* Re-sortear apaga o sorteio inteiro: um duplo clique
                  atrapalhado refaz os times sem querer. */}
              <SubmitButton labelPending="Sorteando…">
                {teamList.length > 0 ? "Re-sortear" : "Fechar lista e sortear"}
              </SubmitButton>
              <span className="text-[12px] text-fg-4">
                {confirmed.length} confirmados
                {teamList.length === 0 && " · sortear trava a lista: daqui em diante quem inclui é você"}
                {teamList.length > 0 &&
                  gameList.length > 0 &&
                  " · apague os jogos antes de re-sortear"}
              </span>
            </form>
          </CardBody>
        </Card>
      )}

      {teamList.length === 0 ? (
        <EmptyState
          titulo="Ainda não teve sorteio"
          descricao="Sorteie quando a lista de confirmados fechar. Até lá dá para entrar e sair à vontade."
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            {teamList.map((team) => {
              const members = teamMembers.filter((m) => m.teamId === team.id);
              // Soma em centésimos: acumular a nota decimal em ponto flutuante
              // mostraria "Σ 34,400000000000006".
              const skillSum =
                members.reduce((acc, m) => acc + Math.round(m.skill * 100), 0) / 100;
              return (
                <Card key={team.id}>
                  <CardHeader>
                    <VestChip time={team.name} tamanho="lg" />
                    <span className="flex-1 font-display text-[15px] font-extrabold font-stretch-112% text-fg">
                      {team.name}
                    </span>
                    <span className="text-right">
                      <Eyebrow>soma · média</Eyebrow>
                      <span className="block font-display text-[13px] font-bold text-fg-2" data-num>
                        {formatSkill(skillSum)} ·{" "}
                        {formatSkill(skillSum / Math.max(members.length, 1))}
                      </span>
                    </span>
                  </CardHeader>
                  <ul className="flex flex-col">
                    {members.map((m) => (
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
                        <span className="min-w-0 flex-1 truncate font-display text-[14px] font-bold text-fg">
                          {m.nickname ?? m.playerName}
                        </span>
                        <Nota valor={m.skill} tamanho="sm" />
                      </li>
                    ))}
                  </ul>
                </Card>
              );
            })}
          </div>

          {matchDay.status !== "finished" && (
            <Card>
              <CardBody>
                <form
                  action={swapPlayersAction.bind(null, matchDay.id)}
                  className="flex flex-wrap items-end gap-3"
                >
                  <span className="w-full font-display text-[13px] font-bold text-fg">
                    Trocar jogadores de time
                  </span>
                  {(["playerA", "playerB"] as const).map((field, i) => (
                    <Field
                      key={field}
                      htmlFor={field}
                      label={i === 0 ? "Sai daqui" : "Vai para cá"}
                      className="min-w-36 flex-1"
                    >
                      <Select id={field} name={field}>
                        {teamList.map((team) => (
                          <optgroup key={team.id} label={team.name}>
                            {teamMembers
                              .filter((m) => m.teamId === team.id)
                              .map((m) => (
                                <option key={m.playerId} value={m.playerId}>
                                  {m.nickname ?? m.playerName}
                                </option>
                              ))}
                          </optgroup>
                        ))}
                      </Select>
                    </Field>
                  ))}
                  <SubmitButton variante="secondary">Trocar</SubmitButton>
                </form>
              </CardBody>
            </Card>
          )}
        </>
      )}
    </Section>
  );
}

export function SecaoJogos({ fut }: { fut: PainelDoFut }) {
  const { matchDay, teamList, gameList, goalRows, lineupRows, teamNameById, podeEditarPlacar } =
    fut;

  if (teamList.length === 0) return null;

  return (
    <Section titulo="Jogos">
      {gameList.map((game, i) => {
        const gameGoals = goalRows.filter((g) => g.gameId === game.id);
        const lineup = lineupRows.filter((m) => m.gameId === game.id);
        const timeA = teamNameById.get(game.teamAId) ?? "";
        const timeB = teamNameById.get(game.teamBId) ?? "";

        return (
          <Card key={game.id}>
            <CardHeader>
              <Eyebrow>jogo {i + 1}</Eyebrow>
              <span className="flex flex-1 items-center gap-2">
                <VestChip time={timeA} tamanho="sm" />
                <span className="font-display text-[13px] font-bold text-fg-2">{timeA}</span>
                <span className="text-fg-4">×</span>
                <VestChip time={timeB} tamanho="sm" />
                <span className="font-display text-[13px] font-bold text-fg-2">{timeB}</span>
              </span>
              {matchDay.status !== "finished" && (
                <form action={deleteGame.bind(null, matchDay.id, game.id)}>
                  <SubmitButton variante="ghost" tamanho="sm" className="text-danger-ink">
                    Excluir jogo
                  </SubmitButton>
                </form>
              )}
            </CardHeader>

            <CardBody className="flex flex-col gap-3">
              <form
                action={updateGameScore.bind(null, matchDay.id, game.id)}
                className="flex items-center gap-2"
              >
                <Input
                  name="scoreA"
                  type="number"
                  min={0}
                  defaultValue={game.scoreA}
                  aria-label={`Gols do ${timeA}`}
                  className="w-16 text-center"
                />
                <span className="text-fg-4">×</span>
                <Input
                  name="scoreB"
                  type="number"
                  min={0}
                  defaultValue={game.scoreB}
                  aria-label={`Gols do ${timeB}`}
                  className="w-16 text-center"
                />
                {podeEditarPlacar && (
                  <SubmitButton variante="secondary" tamanho="sm">
                    Salvar placar
                  </SubmitButton>
                )}
              </form>

              {gameGoals.length > 0 && (
                <HairlineList as="ul">
                  {gameGoals.map((goal) => (
                    <HairlineRow as="li" key={goal.id}>
                      <span className="flex-1 truncate text-[13px] text-fg-2">
                        {goal.nickname ?? goal.playerName}
                        {goal.quantity > 1 ? ` ×${goal.quantity}` : ""}
                      </span>
                      {podeEditarPlacar && (
                        <form action={deleteGoal.bind(null, matchDay.id, goal.id)}>
                          <SubmitButton variante="ghost" tamanho="sm" className="text-danger-ink">
                            Remover
                          </SubmitButton>
                        </form>
                      )}
                    </HairlineRow>
                  ))}
                </HairlineList>
              )}

              {podeEditarPlacar && (
                <form
                  action={addGoal.bind(null, matchDay.id, game.id)}
                  className="flex flex-wrap items-end gap-2"
                >
                  <Field
                    htmlFor={`gol-${game.id}`}
                    label="Quem marcou"
                    className="min-w-40 flex-1"
                  >
                    <Select id={`gol-${game.id}`} name="playerId">
                      {(["A", "B"] as const).map((side) => (
                        <optgroup key={side} label={side === "A" ? timeA : timeB}>
                          {lineup
                            .filter((m) => m.side === side)
                            .map((m) => (
                              <option key={m.playerId} value={m.playerId}>
                                {m.nickname ?? m.playerName}
                              </option>
                            ))}
                        </optgroup>
                      ))}
                    </Select>
                  </Field>
                  <Field htmlFor={`qtd-${game.id}`} label="Quantos" className="w-24">
                    <Input
                      id={`qtd-${game.id}`}
                      name="quantity"
                      type="number"
                      min={1}
                      max={20}
                      defaultValue={1}
                      className="text-center"
                    />
                  </Field>
                  <SubmitButton variante="secondary">+ Gol</SubmitButton>
                </form>
              )}
            </CardBody>
          </Card>
        );
      })}

      {matchDay.status !== "finished" && teamList.length >= 2 && (
        <Card>
          <CardHeader>
            <span className="font-display text-[14px] font-bold text-fg">Novo jogo</span>
          </CardHeader>
          <CardBody>
            <form
              action={createGame.bind(null, matchDay.id)}
              className="flex flex-wrap items-end gap-2"
            >
              <Field htmlFor="teamAId" label="Time A" className="min-w-32 flex-1">
                <Select id="teamAId" name="teamAId">
                  {teamList.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field htmlFor="novo-scoreA" label="Gols" className="w-20">
                <Input
                  id="novo-scoreA"
                  name="scoreA"
                  type="number"
                  min={0}
                  defaultValue={0}
                  className="text-center"
                />
              </Field>
              <Field htmlFor="novo-scoreB" label="Gols" className="w-20">
                <Input
                  id="novo-scoreB"
                  name="scoreB"
                  type="number"
                  min={0}
                  defaultValue={0}
                  className="text-center"
                />
              </Field>
              <Field htmlFor="teamBId" label="Time B" className="min-w-32 flex-1">
                <Select id="teamBId" name="teamBId" defaultValue={teamList[1]?.id}>
                  {teamList.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <SubmitButton>Adicionar</SubmitButton>
            </form>
          </CardBody>
        </Card>
      )}
    </Section>
  );
}

export function SecaoEncerrar({ fut }: { fut: PainelDoFut }) {
  const { matchDay, dentroDaJanela } = fut;

  if (matchDay.status === "finished") {
    return (
      <Section titulo="Encerramento">
        <Banner tom="info">
          Fut encerrado — os resultados contam na artilharia, nos rankings e na presença, e a
          escalação está travada.
        </Banner>
        {dentroDaJanela ? (
          <div className="flex flex-wrap items-center gap-2">
            <Prazo horas={Math.ceil(matchDay.segundosDeJanela / 3600)} />
            <span className="text-[13px] text-fg-2">
              Placar e gols ainda podem ser corrigidos.
            </span>
          </div>
        ) : (
          <Banner tom="aviso">
            A janela de 24h para corrigir placar e gols já passou. Só dá para alterar este fut
            excluindo ela — o que exige votação de quem jogou.
          </Banner>
        )}
      </Section>
    );
  }

  return (
    <Section titulo="Encerramento">
      <Card>
        <CardBody className="flex flex-col items-start gap-3">
          <p className="text-[13px] leading-[1.5] text-fg-2">
            Encerrar passa pela conferência da escalação. Depois disso ela não muda mais, e a
            rodada de avaliação abre para quem jogou.
          </p>
          <LinkButton href={`/fut/${matchDay.id}/gerenciar/encerrar`}>
            Conferir escalação e encerrar
          </LinkButton>
        </CardBody>
      </Card>
    </Section>
  );
}

export function ZonaDePerigo({ fut }: { fut: PainelDoFut }) {
  const { matchDay, votacao, faltamVotar } = fut;

  return (
    <Section titulo="Zona de perigo">
      <Card className="border-danger-line">
        <CardHeader className="border-danger-line bg-danger-tint">
          <span className="font-display text-[14px] font-extrabold font-stretch-112% text-danger-ink uppercase">
            Excluir este fut
          </span>
        </CardHeader>
        <CardBody className="flex flex-col gap-3">
          {matchDay.status !== "finished" ? (
            <form action={deleteMatchDay.bind(null, matchDay.id)} className="flex flex-col gap-3">
              <p className="text-[13px] leading-[1.5] text-fg-2">
                Apaga presenças, times e resultados. Como o fut não foi encerrado, nada dele
                conta em ranking ou avaliação — dá para excluir direto.
              </p>
              <SubmitButton
                variante="danger"
                labelPending="Excluindo…"
                className="self-start"
              >
                Excluir agora
              </SubmitButton>
            </form>
          ) : votacao ? (
            <div className="flex flex-col gap-2">
              <p className="text-[13px] leading-[1.5] text-fg-2">
                <strong className="text-fg">
                  Votação{" "}
                  {votacao.status === "open"
                    ? "em andamento"
                    : votacao.status === "approved"
                      ? "aprovada"
                      : "rejeitada"}
                </strong>{" "}
                — “{votacao.reason}”
              </p>
              {/* Enquanto a votação corre, quem propôs vê só quantos faltam —
                  nunca o placar nem os nomes. Com placar e lista de faltantes,
                  dois refreshes seguidos dizem como fulano votou, num voto que
                  a regra chama de definitivo. O tipo de getVotacaoDoFut nem
                  traz sim/nao enquanto está aberta. */}
              {votacao.status === "open" ? (
                <p className="text-[13px] text-fg-3">
                  Faltam {faltamVotar} de {votacao.eligibleCount} votarem · precisa de{" "}
                  {votacao.requiredYes} sim · <Prazo horas={votacao.horasRestantes} />
                </p>
              ) : (
                <p className="text-[13px] text-fg-3">
                  {votacao.sim} a favor · {votacao.nao} contra · precisava de {votacao.requiredYes}{" "}
                  de {votacao.eligibleCount}
                </p>
              )}
              {votacao.status === "rejected" && (
                <p className="text-[13px] text-fg-3">
                  O grupo decidiu manter. Um fut só pode ter uma votação, então ela fica no
                  histórico definitivamente.
                </p>
              )}
            </div>
          ) : (
            <form
              action={abrirVotacaoExclusao.bind(null, matchDay.id)}
              className="flex flex-col gap-3"
            >
              <p className="text-[13px] leading-[1.5] text-fg-2">
                O fut já foi encerrado: os gols, o V/E/D e as avaliações dele contam para todo
                mundo. Apagar exige a aprovação de quem jogou — 85% dos votos em 48h, e quem não
                votar conta como contra.{" "}
                <strong className="text-fg">Só existe uma votação por fut.</strong>
              </p>
              <Field htmlFor="reason" label="Por que este fut precisa ser apagado?" obrigatorio>
                <Input
                  id="reason"
                  name="reason"
                  required
                  minLength={10}
                  maxLength={500}
                  placeholder="O placar do segundo jogo foi lançado errado…"
                />
              </Field>
              {/* Só existe uma votação por fut, para sempre: abrir duas
                  vezes por engano não tem desfazer. */}
              <SubmitButton
                variante="danger-outline"
                labelPending="Abrindo…"
                className="self-start"
              >
                Abrir votação de exclusão
              </SubmitButton>
            </form>
          )}
        </CardBody>
      </Card>
    </Section>
  );
}
