import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { LinkButton, SubmitButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader, Eyebrow, Section } from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { EmptyState } from "@/components/ui/empty-state";
import { Checkbox, Field, Input, Select } from "@/components/ui/field";
import { AcaoDaLinha, LinhaDeCampos } from "@/components/ui/linha-de-campos";
import { HairlineList, HairlineRow } from "@/components/ui/hairline-list";
import { IconeSeta } from "@/components/ui/icons";
import { DestaqueNoNome, NomeJogador, pinturaDoNome } from "@/components/ui/nome-jogador";
import { Nota } from "@/components/ui/nota";
import { Prazo } from "@/components/ui/prazo";
import { VestChip } from "@/components/ui/vest";
import { cx } from "@/lib/cx";
import { formatPercent, formatTime } from "@/lib/format";
import { JANELA_CORRECAO_HORAS } from "@/lib/regras";
import { jogoEmAndamento } from "@/lib/sumula";
import { futAceitaEntrada } from "@/lib/fut-entrada";
import { urlDoLinkDoFut } from "@/lib/fut-entrada-db";
import {
  decidirPedidoDeFut,
  gerarLinkDoFutAction,
  revogarLinkDoFutAction,
} from "@/app/(esqueleto)/fut/[id]/entrada-actions";
import { listaFechada } from "@/lib/lista-presenca";
import { emailConfigurado } from "@/lib/email-envio";
import { siteUrl } from "@/lib/site-url";
import { PRAZO_ABERTURA_EXCLUSAO_HORAS, PRAZO_VOTACAO_HORAS, QUORUM } from "@/lib/votacao";
import { BuscaJogador, type ItemJogador } from "@/components/ui/busca-jogador";
import {
  abrirVotacaoExclusao,
  addGoal,
  convidarParaFut,
  createGame,
  definirAutorDoGol,
  definirPresenca,
  deleteGame,
  deleteGoal,
  deleteMatchDay,
  drawTeamsAction,
  marcarFalta,
  montarTimesAction,
  moverJogadorAction,
  promoverDaEspera,
  reenviarConviteDoFut,
  updateGameScore,
  updateMatchDay,
} from "./actions";
import type { PainelDoFut } from "./dados";
import { EditorDeTimes } from "./editor-de-times";
import { LADOS_DO_RASCUNHO, repartirEmColunas, type JogadorDeTime } from "@/lib/montar-times";
import { defaultTeamNames } from "@/lib/team-colors";

// As seções do painel moram aqui, e não na página, porque o arquivo passava de
// 760 linhas e qualquer mudança numa seção exigia rolar as outras cinco. As
// Server Actions e o contrato de ?erro= continuam exatamente os mesmos.

export function SecaoDados({ fut }: { fut: PainelDoFut }) {
  const { matchDay } = fut;
  return (
    <Section titulo="Dados do fut">
      <Card>
        <CardBody>
          {/* Seis campos e um botão não cabem numa linha só em 640px: as
              trilhas ficariam menores que o conteúdo. Três linhas, como
              /futs/novo já fazia. */}
          <form
            action={updateMatchDay.bind(null, matchDay.id)}
            className="flex flex-col gap-4"
          >
            <LinhaDeCampos colunas={["curto", "curto", "curto"]}>
              <Field htmlFor="g-date" label="Data" obrigatorio>
                <Input id="g-date" name="date" type="date" required defaultValue={matchDay.date} />
              </Field>
              <Field htmlFor="g-time" label="Horário">
                <Input
                  id="g-time"
                  name="startTime"
                  type="time"
                  defaultValue={formatTime(matchDay.startTime) ?? ""}
                />
              </Field>
              <Field htmlFor="g-end" label="Término" ajuda="Vazio = 1h.">
                <Input
                  id="g-end"
                  name="endTime"
                  type="time"
                  defaultValue={formatTime(matchDay.endTime) ?? ""}
                />
              </Field>
            </LinhaDeCampos>

            <LinhaDeCampos colunas={["cheio", "curto"]}>
              <Field htmlFor="g-local" label="Local" obrigatorio>
                <Input id="g-local" name="location" required defaultValue={matchDay.location} />
              </Field>
              <Field htmlFor="g-vagas" label="Vagas" ajuda="Vazio = sem limite.">
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
            </LinhaDeCampos>

            <LinhaDeCampos colunas={["cheio", "acao"]}>
              <Field htmlFor="g-notes" label="Observações">
                <Input id="g-notes" name="notes" defaultValue={matchDay.notes ?? ""} />
              </Field>
              <AcaoDaLinha>
                <SubmitButton>Salvar</SubmitButton>
              </AcaoDaLinha>
            </LinhaDeCampos>
          </form>
        </CardBody>
      </Card>
    </Section>
  );
}

export function SecaoPresenca({ fut }: { fut: PainelDoFut }) {
  const {
    matchDay,
    activePlayers,
    jogadorPorId,
    lista,
    statusByPlayer,
    recusaram,
    confirmed,
    convitesParaEntregar,
    cosmeticos,
  } = fut;
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
                      const doNome = cosmeticos.get(linha.playerId);
                      const pintura = pinturaDoNome(doNome?.cor);
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
                          {/* Sem o NomeJogador: a linha aqui é de TRABALHO — tem
                              ordem de chegada de um lado e botões do outro, e o
                              nome de batismo embaixo empurraria os dois para
                              longe um do outro. Mas os cosméticos vêm, e com os
                              helpers DELE: é a mesma lista da tela pública do
                              fut, e ver o nome cru só aqui era a diferença que
                              não tinha explicação. */}
                          <span className="flex min-w-0 flex-1 items-center gap-1.5">
                            <DestaqueNoNome destaque={doNome?.destaque} />
                            <span
                              style={pintura.style}
                              className={cx(
                                "min-w-0 truncate font-display text-[14px] font-bold",
                                pintura.className,
                              )}
                            >
                              {jogador.nickname ?? jogador.name}
                            </span>
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
          // Disse não para este fut — tirando o nome ou recusando o convite. O
          // selo é diferente do "fora" porque a situação é: "fora" o organizador
          // desfaz, esta ele não desfaz. E o botão "Vai" some, porque
          // `definirPresenca` recusaria com `?erro=recusou`.
          const recusou = recusaram.has(player.id);
          return {
            id: player.id,
            nome: player.name,
            apelido: player.nickname,
            selos: (
              <>
                {status === "in" && <Badge tom="accent">vai</Badge>}
                {status === "waitlist" && <Badge tom="neutral">espera</Badge>}
                {status === "no_show" && <Badge tom="neutral">não veio</Badge>}
                {status === "out" && !recusou && <Badge tom="neutral">fora</Badge>}
                {recusou && <Badge tom="neutral">disse que não vai</Badge>}
              </>
            ),
            acoes: (
              <>
                {status !== "in" && !recusou && (
                  <form action={definirPresenca.bind(null, matchDay.id, player.id, "in")}>
                    <SubmitButton tamanho="sm">Vai</SubmitButton>
                  </form>
                )}
                {/* "Fora" some pelo mesmo motivo que o "Vai": `avaliarMarcacao`
                    barra quem recusou nos DOIS sentidos, então o clique só
                    produziria `?erro=recusou` — cuja mensagem fala de voltar a
                    entrar, que não é o que quem organiza estava tentando. */}
                {status !== "out" && !recusou && (
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
              <LinhaDeCampos colunas={["medio", "medio"]}>
                <Field htmlFor="novo-nome" label="Nome" obrigatorio>
                  <Input
                    id="novo-nome"
                    name="name"
                    required
                    maxLength={60}
                    placeholder="Nome do jogador"
                  />
                </Field>
                <Field htmlFor="novo-email" label="E-mail (conta Google)" ajuda="Opcional.">
                  <Input
                    id="novo-email"
                    name="email"
                    type="email"
                    maxLength={160}
                    placeholder="fulano@gmail.com"
                  />
                </Field>
              </LinhaDeCampos>
              <Checkbox name="isGoalkeeper" label="É goleiro" />
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


/**
 * Quem quer entrar, e por onde entra.
 *
 * A seção existe porque a marcação de presença por terceiro deixou de alcançar
 * estranhos em fut avulso (ver podeDefinirPresencaPor). O que substituiu aquilo
 * são três caminhos com decisor próprio, e dois deles pedem uma decisão de quem
 * organiza — a fila de pedidos e o link. O terceiro (convite) sai da página
 * pública do fut, onde está a lista de quem já jogou com você.
 *
 * Some inteira depois do sorteio: `futAceitaEntrada` é falso e nada aqui teria
 * efeito.
 */
export function SecaoEntrada({ fut }: { fut: PainelDoFut }) {
  const { matchDay, pedidosDeEntrada, convitesDeFut, linkDoFut, cosmeticos } = fut;
  if (!futAceitaEntrada(matchDay)) return null;

  const url = linkDoFut ? urlDoLinkDoFut(linkDoFut.token) : null;

  return (
    <Section titulo="Quem quer entrar">
      {pedidosDeEntrada.length > 0 && (
        <Card>
          <CardHeader>
            <span className="font-display text-[14px] font-bold text-fg">
              Pedidos ({pedidosDeEntrada.length})
            </span>
          </CardHeader>
          <ul className="flex flex-col">
            {pedidosDeEntrada.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center gap-2 border-b border-line-soft px-4 py-3 last:border-0"
              >
                <NomeJogador
                  apelido={p.nickname}
                  nome={p.name}
                  cosmeticos={cosmeticos.get(p.playerId)}
                />
                {p.isGoalkeeper && <Badge tom="warn">goleiro</Badge>}
                <Nota valor={p.skill} />
                <form action={decidirPedidoDeFut.bind(null, matchDay.id, p.id, true)}>
                  <SubmitButton tamanho="sm">Aceitar</SubmitButton>
                </form>
                <form action={decidirPedidoDeFut.bind(null, matchDay.id, p.id, false)}>
                  <SubmitButton variante="secondary" tamanho="sm">
                    Recusar
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {convitesDeFut.length > 0 && (
        <Card>
          <CardHeader>
            <span className="font-display text-[14px] font-bold text-fg">
              Chamados, esperando resposta
            </span>
          </CardHeader>
          <ul className="flex flex-col">
            {convitesDeFut.map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-center gap-2 border-b border-line-soft px-4 py-3 last:border-0"
              >
                <NomeJogador
                  apelido={c.nickname}
                  nome={c.name}
                  cosmeticos={cosmeticos.get(c.playerId)}
                />
                <Badge tom="dashed">aguardando</Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <CardHeader>
          <span className="font-display text-[14px] font-bold text-fg">Link do fut</span>
        </CardHeader>
        <CardBody>
          {url ? (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-selo bg-surface-2 px-2 py-1 text-[11px] text-fg-3">
                  {url}
                </code>
                <CopyButton text={url} />
                <form action={revogarLinkDoFutAction.bind(null, matchDay.id, linkDoFut!.id)}>
                  <SubmitButton variante="secondary" tamanho="sm">
                    Revogar
                  </SubmitButton>
                </form>
              </div>
              <p className="text-[12px] text-fg-3">
                Quem abrir com uma conta entra direto na lista.
                {linkDoFut!.maxUses !== null &&
                  ` ${linkDoFut!.usesCount} de ${linkDoFut!.maxUses} usos.`}
              </p>
            </div>
          ) : (
            <form action={gerarLinkDoFutAction.bind(null, matchDay.id)} className="flex flex-col gap-2">
              <p className="text-[12.5px] text-fg-2">
                Para chamar quem ainda não jogou com você: manda o link, e quem abrir entra.
              </p>
              <LinhaDeCampos colunas={["curto", "acao"]}>
                <Field htmlFor="maxUses" label="Limite de usos" ajuda="Vazio = sem limite.">
                  <Input id="maxUses" name="maxUses" type="number" min={1} max={60} />
                </Field>
                <AcaoDaLinha>
                  {/* Tamanho md, não sm: h-8 ao lado de um input h-10 é o
                      degrau que a linha existe para não ter. */}
                  <SubmitButton>Gerar link</SubmitButton>
                </AcaoDaLinha>
              </LinhaDeCampos>
            </form>
          )}
        </CardBody>
      </Card>
    </Section>
  );
}

export function SecaoTimes({ fut }: { fut: PainelDoFut }) {
  const { matchDay, teamList, teamMembers, confirmed, gameList } = fut;
  const aberta = matchDay.status === "scheduled";

  // As colunas do editor. Com a lista aberta são um rascunho: todo confirmado
  // em "Sem time" e dois lados vazios (o localStorage do editor repõe o que o
  // organizador já tinha arrastado). Fechada, vêm do banco — e quem entrou
  // depois do sorteio (SecaoEntrada) aparece em "Sem time" esperando colete.
  const confirmadosComoJogadores: JogadorDeTime[] = confirmed.map((p) => ({
    playerId: p.id,
    nome: p.nickname ?? p.name,
    skill: p.skill,
    isGoalkeeper: p.isGoalkeeper,
  }));
  const colunas = aberta
    ? repartirEmColunas(
        confirmadosComoJogadores,
        LADOS_DO_RASCUNHO.map((lado, i) => ({ chave: lado, nome: defaultTeamNames[i] })),
        new Map(),
      )
    : repartirEmColunas(
        // Quem tem colete mas saiu da lista continua aparecendo no time — é o
        // organizador que tira (a action aceita mover para "Sem time").
        [
          ...confirmadosComoJogadores,
          ...teamMembers
            .filter((m) => !confirmed.some((p) => p.id === m.playerId))
            .map((m) => ({
              playerId: m.playerId,
              nome: m.nickname ?? m.playerName,
              skill: m.skill,
              isGoalkeeper: m.isGoalkeeper,
            })),
        ],
        teamList.map((t) => ({ chave: String(t.id), nome: t.name })),
        new Map(teamMembers.map((m) => [m.playerId, String(m.teamId)])),
      );

  return (
    <Section titulo="Times">
      {matchDay.status !== "finished" && (
        <Card>
          <CardBody>
            <form
              action={drawTeamsAction.bind(null, matchDay.id)}
              className="flex flex-col gap-2"
            >
              <LinhaDeCampos colunas={["curto", "acao"]}>
                <Field htmlFor="teamCount" label="Nº de times">
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
                <AcaoDaLinha>
                  {/* Re-sortear apaga o sorteio inteiro: um duplo clique
                      atrapalhado refaz os times sem querer. */}
                  <SubmitButton labelPending="Sorteando…">
                    {teamList.length > 0 ? "Re-sortear" : "Fechar lista e sortear"}
                  </SubmitButton>
                </AcaoDaLinha>
              </LinhaDeCampos>
              {/* Abaixo da linha, e não como terceira coluna: é aviso do form
                  inteiro, e num celular uma coluna de texto ao lado do botão
                  ficaria com duas palavras por linha. */}
              <span className="text-[12px] text-fg-4">
                {confirmed.length} confirmados
                {aberta && " · sortear trava a lista: daqui em diante quem inclui é você"}
                {teamList.length > 0 &&
                  gameList.length > 0 &&
                  " · apague os jogos antes de re-sortear"}
              </span>
            </form>
          </CardBody>
        </Card>
      )}

      {aberta ? (
        // O outro caminho para fechar a lista: montar os times na mão. Fica
        // fechado por padrão — a maioria dos futs sorteia — e não custa
        // consulta nenhuma: as colunas saem dos confirmados que já vieram.
        <details className="group rounded-card border border-line bg-surface">
          <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 font-display text-[13px] font-bold text-fg select-none">
            <IconeSeta className="size-4 shrink-0 text-fg-4 transition-transform group-open:rotate-90" />
            Montar times na mão
            <span className="ml-auto text-[12px] font-normal text-fg-4">
              arraste ou toque no colete
            </span>
          </summary>
          <div className="border-t border-line p-4">
            {confirmed.length === 0 ? (
              <EmptyState
                titulo="Ninguém confirmado ainda"
                descricao="Os times se montam a partir de quem está na lista."
              />
            ) : (
              <EditorDeTimes
                futId={matchDay.id}
                modo="rascunho"
                colunas={colunas}
                fecharLista={montarTimesAction.bind(null, matchDay.id)}
              />
            )}
          </div>
        </details>
      ) : (
        // Depois de cada movimento o servidor revalida e o editor recebe as
        // colunas reais no lugar do palpite otimista (ver o sync por prop lá).
        <EditorDeTimes
          futId={matchDay.id}
          modo={matchDay.status === "finished" ? "leitura" : "gravado"}
          colunas={colunas}
          mover={moverJogadorAction.bind(null, matchDay.id)}
        />
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
              {/* A súmula ao vivo tem este jogo aberto agora. Editar aqui
                  continua permitido (o admin é irrestrito), mas dessincroniza
                  placar × lançamentos de propósito — o selo é o aviso. */}
              {jogoEmAndamento(game) && (
                <Badge tom="accent" ponto>
                  em andamento
                </Badge>
              )}
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
                  {gameGoals.map((goal) => {
                    // Autor nulo = gol contra / sem autor lançado pela súmula
                    // ao vivo; o lado gravado diz de quem foi o ponto.
                    const rotulo =
                      goal.playerName === null
                        ? `Gol contra / sem autor${
                            goal.side === null ? "" : ` (${goal.side === "A" ? timeA : timeB})`
                          }`
                        : (goal.nickname ?? goal.playerName);
                    const lancadoPor = goal.lancadoPor ?? goal.lancadoPorNome;
                    const desfeitoPor = goal.desfeitoPor ?? goal.desfeitoPorNome;
                    return (
                      <HairlineRow as="li" key={goal.id} apagado={goal.desfeito}>
                        <span className="min-w-0 flex-1">
                          <span
                            className={`block truncate text-[13px] ${
                              goal.desfeito
                                ? "line-through"
                                : goal.playerName === null
                                  ? "text-fg-4 italic"
                                  : "text-fg-2"
                            }`}
                          >
                            {rotulo}
                            {goal.quantity > 1 ? ` ×${goal.quantity}` : ""}
                          </span>
                          {/* A trilha da súmula: quem lançou — e, riscado, quem
                              desfez o quê. É aqui que o admin confere se a
                              ferramenta foi usada direito. */}
                          {(goal.desfeito ? desfeitoPor : lancadoPor) && (
                            <span className="block truncate text-[11.5px] text-fg-4">
                              {goal.desfeito
                                ? `desfeito por ${desfeitoPor}`
                                : `lançado por ${lancadoPor}`}
                            </span>
                          )}
                        </span>
                        {!goal.desfeito && podeEditarPlacar && goal.playerName === null && (
                          <form
                            action={definirAutorDoGol.bind(null, matchDay.id, goal.id)}
                            className="flex items-center gap-1.5"
                          >
                            {/* Só quem jogou do lado do gol: creditar quem
                                marcou contra inverteria o registro. */}
                            <Select
                              name="playerId"
                              aria-label="Autor do gol"
                              className="h-8 w-36 text-[12px]"
                            >
                              {lineup
                                .filter((m) => goal.side === null || m.side === goal.side)
                                .map((m) => (
                                  <option key={m.playerId} value={m.playerId}>
                                    {m.nickname ?? m.playerName}
                                  </option>
                                ))}
                            </Select>
                            <SubmitButton variante="ghost" tamanho="sm">
                              Definir autor
                            </SubmitButton>
                          </form>
                        )}
                        {!goal.desfeito && podeEditarPlacar && (
                          <form action={deleteGoal.bind(null, matchDay.id, goal.id)}>
                            <SubmitButton variante="ghost" tamanho="sm" className="text-danger-ink">
                              Remover
                            </SubmitButton>
                          </form>
                        )}
                      </HairlineRow>
                    );
                  })}
                </HairlineList>
              )}

              {podeEditarPlacar && (
                <form action={addGoal.bind(null, matchDay.id, game.id)}>
                  <LinhaDeCampos colunas={["cheio", "minimo", "acao"]}>
                    <Field htmlFor={`gol-${game.id}`} label="Quem marcou">
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
                    <Field htmlFor={`qtd-${game.id}`} label="Quantos">
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
                    <AcaoDaLinha>
                      <SubmitButton variante="secondary">+ Gol</SubmitButton>
                    </AcaoDaLinha>
                  </LinhaDeCampos>
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
            {/* Quatro colunas é o teto da LinhaDeCampos, então o botão desce
                para a sua própria linha em vez de virar a quinta. */}
            <form action={createGame.bind(null, matchDay.id)} className="flex flex-col gap-3">
              <LinhaDeCampos colunas={["cheio", "minimo", "minimo", "cheio"]}>
                <Field htmlFor="teamAId" label="Time A">
                  <Select id="teamAId" name="teamAId">
                    {teamList.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field htmlFor="novo-scoreA" label="Gols">
                  <Input
                    id="novo-scoreA"
                    name="scoreA"
                    type="number"
                    min={0}
                    defaultValue={0}
                    className="text-center"
                  />
                </Field>
                <Field htmlFor="novo-scoreB" label="Gols">
                  <Input
                    id="novo-scoreB"
                    name="scoreB"
                    type="number"
                    min={0}
                    defaultValue={0}
                    className="text-center"
                  />
                </Field>
                <Field htmlFor="teamBId" label="Time B">
                  <Select id="teamBId" name="teamBId" defaultValue={teamList[1]?.id}>
                    {teamList.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              </LinhaDeCampos>
              <SubmitButton className="self-start">Adicionar</SubmitButton>
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
            A janela de {JANELA_CORRECAO_HORAS}h para corrigir placar e gols já passou. Só dá
            para alterar este fut excluindo ela — o que exige votação de quem jogou.
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
  const { matchDay, votacao, faltamVotar, janelaExclusao } = fut;

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
          ) : !janelaExclusao.aberta ? (
            <Banner tom="aviso">
              O prazo para abrir a votação de exclusão já passou — ele vale até{" "}
              {PRAZO_ABERTURA_EXCLUSAO_HORAS} horas depois do fim do prazo de contestação das
              notas. Este fut fica no histórico.
            </Banner>
          ) : (
            <form
              action={abrirVotacaoExclusao.bind(null, matchDay.id)}
              className="flex flex-col gap-3"
            >
              <p className="text-[13px] leading-[1.5] text-fg-2">
                O fut já foi encerrado: os gols, o V/E/D e as avaliações dele contam para todo
                mundo. Apagar exige a aprovação de quem jogou — {formatPercent(QUORUM)} dos
                votos em {PRAZO_VOTACAO_HORAS}h, e quem não votar conta como contra. O pedido
                também tem hora: dá para abrir até {PRAZO_ABERTURA_EXCLUSAO_HORAS} horas depois
                do fim do prazo de contestação das notas.{" "}
                <strong className="text-fg">Só existe uma votação por fut.</strong>{" "}
                <Link href="/guia#apagar-um-fut" className="text-accent-ink hover:underline">
                  Como a exclusão funciona
                </Link>
              </p>
              {janelaExclusao.horasRestantes !== null && (
                <div className="flex flex-wrap items-center gap-2">
                  <Prazo horas={janelaExclusao.horasRestantes} />
                  <span className="text-[13px] text-fg-2">para abrir a votação.</span>
                </div>
              )}
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
