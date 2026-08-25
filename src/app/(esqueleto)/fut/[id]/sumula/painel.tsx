"use client";

// O painel da súmula ao vivo. É client component pelo que forms não fazem —
// abrir/fechar o bottom sheet de autor e armar a confirmação de dois toques —
// mas TODA mutação continua no padrão da casa: <form action={bind}> +
// SubmitButton, que já desabilita e mostra spinner em voo (o anti-double-tap
// que um painel de toque rápido mais precisa). Sem useOptimistic de propósito:
// a falha típica aqui é concorrência ("outro operador finalizou o jogo"), e um
// placar otimista mentiria exatamente no momento em que não pode — se a
// latência de 1–4s da action incomodar na prática, o upgrade é isolado neste
// arquivo (useOptimistic sobre scoreA/scoreB), sem mexer em action nenhuma.

import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, SubmitButton, type BotaoVariante } from "@/components/ui/button";
import { Card, CardBody, CardHeader, Eyebrow, Section } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Select } from "@/components/ui/field";
import { AcaoDaLinha, LinhaDeCampos } from "@/components/ui/linha-de-campos";
import { HairlineList, HairlineRow } from "@/components/ui/hairline-list";
import { VestChip } from "@/components/ui/vest";
import {
  delegarSumula,
  desfazerLancamento,
  finalizarJogo,
  iniciarJogo,
  lancarGol,
  revogarSumula,
  trocarDeLado,
} from "./actions";

export type GolNaSumula = {
  tipo: "gol";
  id: number;
  lado: "A" | "B" | null;
  /** Apelido ou nome do autor; null = gol contra / sem autor. */
  autor: string | null;
  lancadoPor: string | null;
  tempoAtras: string;
  desfeito: boolean;
  desfeitoPor: string | null;
  /** Decidido no servidor (regra do último-do-lado para delegado) — a action re-valida. */
  podeDesfazer: boolean;
};

export type TrocaNaSumula = {
  tipo: "troca";
  id: number;
  /** Apelido ou nome de quem trocou de lado. */
  jogador: string;
  de: "A" | "B";
  para: "A" | "B";
  /** Quem operava a súmula na hora; null = operador apagado. */
  por: string | null;
  tempoAtras: string;
};

/** Os dois eventos que a linha do tempo mostra, já ordenados pelo servidor. */
export type EventoNaSumula = GolNaSumula | TrocaNaSumula;

export type JogoAberto = {
  id: number;
  scoreA: number;
  scoreB: number;
  timeA: string;
  timeB: string;
  emAndamentoHa: string;
  ladoA: { playerId: number; rotulo: string }[];
  ladoB: { playerId: number; rotulo: string }[];
  eventos: EventoNaSumula[];
};

export type PainelSumulaProps = {
  matchDayId: number;
  ehAdminDoFut: boolean;
  jogo: JogoAberto | null;
  times: { id: number; nome: string }[];
  jogosAnteriores: { id: number; timeA: string; timeB: string; scoreA: number; scoreB: number }[];
  operadores: { playerId: number; rotulo: string; delegadoPor: string | null }[];
  candidatos: { playerId: number; rotulo: string }[];
};

export function PainelSumula(props: PainelSumulaProps) {
  const { matchDayId, jogo } = props;
  const [ladoAberto, setLadoAberto] = useState<"A" | "B" | null>(null);

  // O sheet fecha quando o GOL aterrissa — o id do gol mais recente muda quando
  // o payload novo do servidor chega. Fechar no toque cancelaria o submit junto
  // (o form desmontaria antes do dispatch); fechar aqui é honesto: o spinner do
  // jogador tocado fica visível até o gol existir de verdade.
  //
  // Só os gols contam: a linha do tempo agora também traz as trocas de lado, e
  // uma troca de outro operador fechando o sheet de quem está escolhendo o
  // autor seria o toque perdido que este efeito existe para evitar.
  const ultimoGol = jogo?.eventos.find((e) => e.tipo === "gol")?.id ?? null;
  const marcaRef = useRef(ultimoGol);
  useEffect(() => {
    if (ultimoGol !== marcaRef.current) {
      marcaRef.current = ultimoGol;
      setLadoAberto(null);
    }
  }, [ultimoGol]);

  if (!jogo) {
    return (
      <div className="flex flex-col gap-7">
        <SecaoIniciarJogo {...props} />
        <SecaoJogosDoDia jogos={props.jogosAnteriores} />
        {props.ehAdminDoFut && <SecaoDelegacao {...props} />}
      </div>
    );
  }

  const doLado = ladoAberto === "A" ? jogo.ladoA : jogo.ladoB;
  const nomeDoLado = ladoAberto === "A" ? jogo.timeA : jogo.timeB;

  return (
    <div className="flex flex-col gap-7">
      {/* O placar grande — a informação que o painel existe para mostrar. */}
      <Card className="p-4">
        <div className="flex items-center justify-center gap-2">
          <Badge tom="accent" ponto>
            em andamento {jogo.emAndamentoHa}
          </Badge>
        </div>
        <div className="mt-2 flex items-center justify-center gap-4">
          <span className="flex flex-1 flex-col items-end gap-1 text-right">
            <VestChip time={jogo.timeA} tamanho="lg" />
            <span className="truncate font-display text-[13px] font-bold text-fg-2">
              {jogo.timeA}
            </span>
          </span>
          <span
            className="font-display text-[44px] leading-none font-black font-stretch-125% text-fg"
            data-num
          >
            {jogo.scoreA} × {jogo.scoreB}
          </span>
          <span className="flex flex-1 flex-col items-start gap-1">
            <VestChip time={jogo.timeB} tamanho="lg" />
            <span className="truncate font-display text-[13px] font-bold text-fg-2">
              {jogo.timeB}
            </span>
          </span>
        </div>
      </Card>

      {/* Os dois botões gigantes: um toque abre a escalação do lado que marcou. */}
      <div className="grid grid-cols-2 gap-3">
        <BotaoDeGol time={jogo.timeA} onClick={() => setLadoAberto("A")} />
        <BotaoDeGol time={jogo.timeB} onClick={() => setLadoAberto("B")} />
      </div>

      <SecaoEscalacao matchDayId={matchDayId} jogo={jogo} />

      <SecaoLancamentos matchDayId={matchDayId} jogo={jogo} />

      <Section titulo="Fim de jogo">
        <form action={finalizarJogo.bind(null, matchDayId, jogo.id)}>
          <ConfirmarSubmit
            rotulo="Finalizar jogo"
            confirmacao="Confirmar o fim do jogo?"
            tamanho="lg"
            className="w-full"
          />
        </form>
        <p className="text-[11.5px] text-fg-4">
          Finalizado, o placar deste jogo congela no painel — correções depois disso são de quem
          organiza o fut.
        </p>
      </Section>

      {props.ehAdminDoFut && <SecaoDelegacao {...props} />}

      {ladoAberto !== null && (
        <SheetDeAutor
          matchDayId={matchDayId}
          gameId={jogo.id}
          lado={ladoAberto}
          nomeDoTime={nomeDoLado}
          jogadores={doLado}
          aoFechar={() => setLadoAberto(null)}
        />
      )}
    </div>
  );
}

/** ≥96px de alvo: o painel é operado com o polegar, no sol, entre um jogo e outro. */
function BotaoDeGol({ time, onClick }: { time: string; onClick: () => void }) {
  return (
    <Button variante="secondary" onClick={onClick} className="h-24 flex-col gap-1.5">
      <VestChip time={time} tamanho="lg" />
      <span className="max-w-full truncate">Gol do {time}</span>
    </Button>
  );
}

/**
 * O bottom sheet com a escalação do lado que marcou. Cada jogador é um form
 * completo — o submit é o toque final do fluxo, e o SubmitButton segura o
 * double-tap sozinho. O sheet NÃO fecha no toque (ver o comentário do efeito no
 * PainelSumula); fecha quando o gol aterrissa, ou pelo Cancelar/backdrop.
 */
function SheetDeAutor({
  matchDayId,
  gameId,
  lado,
  nomeDoTime,
  jogadores,
  aoFechar,
}: {
  matchDayId: number;
  gameId: number;
  lado: "A" | "B";
  nomeDoTime: string;
  jogadores: { playerId: number; rotulo: string }[];
  aoFechar: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50"
      role="dialog"
      aria-modal="true"
      aria-label={`Quem marcou o gol do ${nomeDoTime}?`}
    >
      <button
        type="button"
        aria-label="Cancelar o lançamento"
        onClick={aoFechar}
        className="absolute inset-0 bg-canvas/70"
      />
      <div className="absolute inset-x-0 bottom-0 max-h-[75dvh] overflow-y-auto rounded-t-card border-t border-line bg-surface p-4 pb-[calc(env(safe-area-inset-bottom)+var(--tabbar-h)+1rem)]">
        <div className="mb-3 flex items-center gap-2">
          <VestChip time={nomeDoTime} />
          <span className="flex-1 font-display text-[15px] font-extrabold font-stretch-112% text-fg">
            Quem marcou pelo {nomeDoTime}?
          </span>
          <Button variante="ghost" tamanho="sm" onClick={aoFechar}>
            Cancelar
          </Button>
        </div>
        <div className="flex flex-col gap-2">
          {jogadores.map((j) => (
            <form key={j.playerId} action={lancarGol.bind(null, matchDayId, gameId)}>
              <input type="hidden" name="side" value={lado} />
              <input type="hidden" name="playerId" value={j.playerId} />
              <SubmitButton variante="secondary" tamanho="lg" className="w-full">
                {j.rotulo}
              </SubmitButton>
            </form>
          ))}
          <form action={lancarGol.bind(null, matchDayId, gameId)}>
            <input type="hidden" name="side" value={lado} />
            {/* Sem playerId: soma no placar sem creditar artilharia — é o
                caminho do gol contra e do gol que ninguém viu quem fez. */}
            <SubmitButton variante="ghost" tamanho="lg" className="w-full">
              Gol contra / sem autor
            </SubmitButton>
          </form>
        </div>
      </div>
    </div>
  );
}

/**
 * Quem está de cada lado AGORA, com o botão de passar para o outro. Fica acima
 * dos lançamentos porque é o que o operador precisa conferir de relance quando
 * alguém troca de colete no meio — e porque trocar é a única ação do painel que
 * muda o que o sheet de autor vai oferecer no gol seguinte.
 */
function SecaoEscalacao({ matchDayId, jogo }: { matchDayId: number; jogo: JogoAberto }) {
  return (
    <Section titulo="Escalação">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <ListaDoLado
          matchDayId={matchDayId}
          gameId={jogo.id}
          time={jogo.timeA}
          outroTime={jogo.timeB}
          jogadores={jogo.ladoA}
        />
        <ListaDoLado
          matchDayId={matchDayId}
          gameId={jogo.id}
          time={jogo.timeB}
          outroTime={jogo.timeA}
          jogadores={jogo.ladoB}
        />
      </div>
      <p className="text-[11.5px] text-fg-4">
        Trocar vale para este jogo e para o colete nos próximos. Os gols já lançados continuam do
        lado em que saíram; vitória, derrota e a avaliação contam o time em que a pessoa terminou.
        Para voltar atrás, é só trocar de novo.
      </p>
    </Section>
  );
}

function ListaDoLado({
  matchDayId,
  gameId,
  time,
  outroTime,
  jogadores,
}: {
  matchDayId: number;
  gameId: number;
  time: string;
  outroTime: string;
  jogadores: { playerId: number; rotulo: string }[];
}) {
  return (
    <Card>
      <CardHeader>
        <span className="flex items-center gap-2">
          <VestChip time={time} tamanho="sm" />
          <span className="truncate font-display text-[13px] font-extrabold font-stretch-112% text-fg">
            {time}
          </span>
        </span>
      </CardHeader>
      <CardBody>
        {jogadores.length === 0 ? (
          <p className="text-[12.5px] text-fg-4">Ninguém deste lado.</p>
        ) : (
          <HairlineList as="ul">
            {jogadores.map((j) => (
              <HairlineRow as="li" key={j.playerId}>
                <span className="min-w-0 flex-1 truncate font-display text-[14px] font-bold text-fg">
                  {j.rotulo}
                </span>
                <form action={trocarDeLado.bind(null, matchDayId, gameId, j.playerId)}>
                  {/* A confirmação diz o DESTINO, e não "Confirma?": no meio do
                      jogo o operador precisa ler para onde a pessoa vai antes
                      do segundo toque. */}
                  <ConfirmarSubmit
                    rotulo="Trocar de lado"
                    confirmacao={`Vai para o ${outroTime}?`}
                    tamanho="sm"
                    className="shrink-0"
                  />
                </form>
              </HairlineRow>
            ))}
          </HairlineList>
        )}
      </CardBody>
    </Card>
  );
}

function SecaoLancamentos({
  matchDayId,
  jogo,
}: {
  matchDayId: number;
  jogo: JogoAberto;
}) {
  if (jogo.eventos.length === 0) {
    return (
      <Section titulo="Lançamentos">
        <EmptyState
          titulo="Nenhum gol ainda"
          descricao="Toque no botão do lado que marcar — o placar sobe na hora."
        />
      </Section>
    );
  }
  const nomeDoLado = (lado: "A" | "B" | null) =>
    lado === "A" ? jogo.timeA : lado === "B" ? jogo.timeB : "";

  return (
    <Section titulo="Lançamentos">
      <HairlineList as="ul">
        {jogo.eventos.map((e) =>
          e.tipo === "troca" ? (
            // A troca não tem desfazer: voltar é trocar de novo, e as duas
            // linhas ficam. O chip é o do time de DESTINO — a linha se lê como
            // "fulano agora é do verde".
            <HairlineRow as="li" key={`troca-${e.id}`}>
              <VestChip time={nomeDoLado(e.para)} tamanho="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-display text-[14px] font-bold text-fg">
                  {e.jogador} foi para o {nomeDoLado(e.para)}
                </span>
                <span className="block truncate text-[11.5px] text-fg-4">
                  {`saiu do ${nomeDoLado(e.de)} · por ${e.por ?? "—"} · ${e.tempoAtras}`}
                </span>
              </span>
            </HairlineRow>
          ) : (
            <HairlineRow as="li" key={`gol-${e.id}`} apagado={e.desfeito}>
              <VestChip time={nomeDoLado(e.lado)} tamanho="sm" />
              <span className="min-w-0 flex-1">
                <span
                  className={`block truncate font-display text-[14px] font-bold ${
                    e.desfeito
                      ? "text-fg-4 line-through"
                      : e.autor === null
                        ? "text-fg-3 italic"
                        : "text-fg"
                  }`}
                >
                  {e.autor ?? "Gol contra / sem autor"}
                </span>
                {/* A auditoria é visível de propósito: todo operador vê quem
                    lançou e quem desfez o quê — é a metade social do anti-abuso. */}
                <span className="block truncate text-[11.5px] text-fg-4">
                  {e.desfeito
                    ? `desfeito por ${e.desfeitoPor ?? "—"}`
                    : `por ${e.lancadoPor ?? "—"} · ${e.tempoAtras}`}
                </span>
              </span>
              {e.podeDesfazer && (
                <form action={desfazerLancamento.bind(null, matchDayId, e.id)}>
                  <ConfirmarSubmit rotulo="Desfazer" confirmacao="Confirma?" tamanho="sm" varianteArmado="danger" className="shrink-0" />
                </form>
              )}
            </HairlineRow>
          ),
        )}
      </HairlineList>
    </Section>
  );
}

function SecaoIniciarJogo({ matchDayId, times }: PainelSumulaProps) {
  if (times.length < 2) {
    return (
      <EmptyState
        titulo="Sem times ainda"
        descricao="A súmula começa depois do sorteio dos times."
      />
    );
  }
  return (
    <Section titulo="Próximo jogo">
      <Card>
        <CardBody>
          <form
            action={iniciarJogo.bind(null, matchDayId)}
            className="flex flex-col gap-3"
          >
            {/* Sem empilhar: "Time A × Time B" é confronto, e empilhado o "×"
                fica sozinho no meio da tela. O "×" era um `pb-2.5` chutado
                para casar com a altura do Select; agora ele cai na faixa do
                controle porque é uma AcaoDaLinha. */}
            <LinhaDeCampos colunas={["cheio", "acao", "cheio"]} empilhaNoCelular={false}>
              <Field htmlFor="sumula-timeA" label="Time A">
                <Select id="sumula-timeA" name="teamAId" defaultValue={times[0]?.id}>
                  {times.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nome}
                    </option>
                  ))}
                </Select>
              </Field>
              <AcaoDaLinha>
                <span className="flex h-10 items-center text-fg-4">×</span>
              </AcaoDaLinha>
              <Field htmlFor="sumula-timeB" label="Time B">
                <Select id="sumula-timeB" name="teamBId" defaultValue={times[1]?.id}>
                  {times.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nome}
                    </option>
                  ))}
                </Select>
              </Field>
            </LinhaDeCampos>
            <SubmitButton tamanho="lg" className="w-full">
              Iniciar jogo
            </SubmitButton>
          </form>
        </CardBody>
      </Card>
      <p className="text-[11.5px] text-fg-4">
        O jogo abre 0 × 0 e o placar sobe a cada toque. Um jogo em andamento por vez.
      </p>
    </Section>
  );
}

function SecaoJogosDoDia({
  jogos,
}: {
  jogos: { id: number; timeA: string; timeB: string; scoreA: number; scoreB: number }[];
}) {
  if (jogos.length === 0) return null;
  return (
    <Section titulo="Jogos de hoje">
      <HairlineList as="ul">
        {jogos.map((j) => (
          <HairlineRow as="li" key={j.id}>
            <span className="flex flex-1 items-center justify-end gap-2">
              <span className="truncate font-display text-[12px] font-bold text-fg-2">
                {j.timeA}
              </span>
              <VestChip time={j.timeA} tamanho="sm" />
            </span>
            <span className="font-display text-[16px] font-black font-stretch-125% text-fg" data-num>
              {j.scoreA} × {j.scoreB}
            </span>
            <span className="flex flex-1 items-center gap-2">
              <VestChip time={j.timeB} tamanho="sm" />
              <span className="truncate font-display text-[12px] font-bold text-fg-2">
                {j.timeB}
              </span>
            </span>
          </HairlineRow>
        ))}
      </HairlineList>
    </Section>
  );
}

function SecaoDelegacao({ matchDayId, operadores, candidatos }: PainelSumulaProps) {
  return (
    <Section titulo="Passar a súmula">
      <Card>
        <CardHeader>
          <Eyebrow>quem pode lançar</Eyebrow>
        </CardHeader>
        <CardBody className="flex flex-col gap-3">
          {operadores.length > 0 && (
            <HairlineList as="ul">
              {operadores.map((o) => (
                <HairlineRow as="li" key={o.playerId}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-display text-[14px] font-bold text-fg">
                      {o.rotulo}
                    </span>
                    {o.delegadoPor && (
                      <span className="block truncate text-[11.5px] text-fg-4">
                        recebeu de {o.delegadoPor}
                      </span>
                    )}
                  </span>
                  <form action={revogarSumula.bind(null, matchDayId, o.playerId)}>
                    <SubmitButton variante="danger-outline" tamanho="sm">
                      Revogar
                    </SubmitButton>
                  </form>
                </HairlineRow>
              ))}
            </HairlineList>
          )}
          {candidatos.length > 0 ? (
            <form action={delegarSumula.bind(null, matchDayId)}>
              <LinhaDeCampos colunas={["cheio", "acao"]}>
                <Field htmlFor="sumula-delegado" label="Quem está revezando fica com o celular">
                  <Select id="sumula-delegado" name="playerId">
                    {candidatos.map((c) => (
                      <option key={c.playerId} value={c.playerId}>
                        {c.rotulo}
                      </option>
                    ))}
                  </Select>
                </Field>
                <AcaoDaLinha>
                  <SubmitButton variante="secondary">Delegar</SubmitButton>
                </AcaoDaLinha>
              </LinhaDeCampos>
            </form>
          ) : (
            operadores.length === 0 && (
              <p className="text-[12.5px] text-fg-4">
                Ninguém para delegar ainda — o jogador precisa estar na lista e ter conta ativa.
              </p>
            )
          )}
          <p className="text-[11.5px] text-fg-4">
            Quem recebe a súmula abre e finaliza os jogos, lança gol, desfaz o último de cada lado e
            troca jogador de lado no jogo em andamento. Não mexe em mais nada do fut — presenças,
            sorteio, edição de placar e encerramento continuam só com quem organiza. Todo lançamento
            e toda troca ficam registrados com autor e hora.
          </p>
        </CardBody>
      </Card>
    </Section>
  );
}

/**
 * Remoção com dois toques: o primeiro arma ("Confirma?"), o segundo submete.
 * Proteção contra dedo errado, não contra má-fé — a de má-fé é a regra do
 * servidor. Desarma sozinho em 4s para o botão não ficar engatilhado esquecido.
 */
function ConfirmarSubmit({
  rotulo,
  confirmacao,
  tamanho = "md",
  varianteArmado = "primary",
  className,
}: {
  rotulo: string;
  confirmacao: string;
  tamanho?: "sm" | "md" | "lg";
  varianteArmado?: BotaoVariante;
  className?: string;
}) {
  const [armado, setArmado] = useState(false);
  useEffect(() => {
    if (!armado) return;
    const timer = setTimeout(() => setArmado(false), 4000);
    return () => clearTimeout(timer);
  }, [armado]);

  if (!armado) {
    return (
      <Button
        variante="secondary"
        tamanho={tamanho}
        className={className}
        onClick={() => setArmado(true)}
      >
        {rotulo}
      </Button>
    );
  }
  return (
    <SubmitButton variante={varianteArmado} tamanho={tamanho} className={className}>
      {confirmacao}
    </SubmitButton>
  );
}
