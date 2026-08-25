"use client";

import { useActionState, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Button, SubmitButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EstrelasInput } from "@/components/ui/estrelas-input";
import { HairlineList } from "@/components/ui/hairline-list";
import { IconeLuva } from "@/components/ui/icons";
import { Meter } from "@/components/ui/meter";
import { enviarAvaliacoes, type AvaliarState } from "./actions";

const initialState: AvaliarState = {};

export type CompanheiroForm = {
  playerId: number;
  rotulo: string;
  nome: string;
  isGoalkeeper: boolean;
  /** Em meias-estrelas (1..10), como tudo que fala com o EstrelasInput. */
  estrelasAtuais?: number;
};

export type CandidatoMvpForm = {
  playerId: number;
  rotulo: string;
  nome: string;
  isGoalkeeper: boolean;
};

export function RatingForm({
  roundId,
  companheiros,
  candidatos,
  mvpAtual,
  jaEnviou,
}: {
  roundId: number;
  companheiros: CompanheiroForm[];
  /** Todos que jogaram o fut e têm conta, menos quem avalia. */
  candidatos: CandidatoMvpForm[];
  /** O voto já enviado, para reabrir o formulário pré-preenchido. */
  mvpAtual: number | null;
  jaEnviou: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    enviarAvaliacoes.bind(null, roundId),
    initialState,
  );

  // O estado existe só para a barra de progresso: os rádios seguem
  // não-controlados e é o `name` deles que o servidor lê. Derivar `feitas` das
  // props deixava a barra parada em zero durante a avaliação inteira, que é
  // justamente quando ela serve para alguma coisa.
  const [notas, setNotas] = useState<Record<number, number>>(() => {
    const inicial: Record<number, number> = {};
    for (const c of companheiros) {
      if (c.estrelasAtuais !== undefined) inicial[c.playerId] = c.estrelasAtuais;
    }
    return inicial;
  });
  const feitas = Object.keys(notas).length;
  const notasCompletas = feitas === companheiros.length;

  // Guarda defensiva: um fut em que só o votante tem conta não tem em quem
  // votar — o envio volta a ser de uma etapa só, e a action aceita sem voto.
  const temEtapaMvp = candidatos.length > 0;

  // As duas etapas vivem no MESMO <form>: a seção inativa fica `hidden`, então
  // os rádios dela não desmontam (nota marcada não se perde) e continuam indo
  // no submit. Voltar e avançar é só alternar o que aparece.
  const [etapa, setEtapa] = useState<"notas" | "mvp">("notas");

  // Igual ao `notas` acima: só para habilitar o botão. O rádio marcado é quem
  // manda no que o servidor lê.
  const [voto, setVoto] = useState<number | null>(() =>
    candidatos.some((c) => c.playerId === mvpAtual) ? mvpAtual : null,
  );

  const trocarEtapa = (proxima: "notas" | "mvp") => {
    setEtapa(proxima);
    // O topo é onde a pergunta da etapa está — sem isso a troca acontece com a
    // tela parada no fim da lista anterior e parece que nada mudou.
    window.scrollTo({ top: 0 });
  };

  return (
    <form action={formAction} className="flex flex-col gap-2.5">
      <div hidden={etapa !== "notas"} className="flex flex-col gap-2.5">
        {companheiros.map((c) => (
          <Card key={c.playerId} className="p-3.5">
            <div className="mb-3 flex items-center gap-2.5">
              <Avatar nome={c.rotulo} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-display text-[16px] leading-[1.2] font-extrabold font-stretch-112% text-fg">
                  {c.rotulo}
                </span>
                {c.nome !== c.rotulo && (
                  <span className="block truncate text-[12px] text-fg-4">{c.nome}</span>
                )}
              </span>
              {c.isGoalkeeper && (
                <Badge tom="warn">
                  <IconeLuva className="size-3" />
                  gol
                </Badge>
              )}
            </div>
            <EstrelasInput
              name={`estrelas-${c.playerId}`}
              legenda={`Nota de ${c.rotulo}`}
              valorPadrao={c.estrelasAtuais}
              aoEscolher={(nota) => setNotas((atual) => ({ ...atual, [c.playerId]: nota }))}
            />
          </Card>
        ))}
      </div>

      {temEtapaMvp && (
        <div hidden={etapa !== "mvp"} className="flex flex-col gap-2.5">
          <div>
            <h2 className="font-display text-[18px] leading-[1.2] font-extrabold font-stretch-112% text-fg">
              Quem foi o melhor em campo?
            </h2>
            <p className="mt-1 text-[12.5px] leading-[1.5] text-fg-3">
              Todo mundo que jogou, dos dois lados — menos você. O mais votado leva o MVP do fut.
            </p>
          </div>
          <HairlineList as="div">
            {candidatos.map((c) => (
              <label
                key={c.playerId}
                className="flex cursor-pointer items-center gap-2.5 bg-surface px-3.5 py-2.5 transition-colors select-none hover:bg-surface-2 has-[input:checked]:bg-accent-tint has-[input:focus-visible]:outline-2 has-[input:focus-visible]:-outline-offset-2 has-[input:focus-visible]:outline-ring"
              >
                <input
                  type="radio"
                  name="mvp"
                  value={c.playerId}
                  defaultChecked={mvpAtual === c.playerId}
                  required
                  onChange={() => setVoto(c.playerId)}
                  className="peer sr-only"
                />
                <Avatar nome={c.rotulo} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-display text-[14.5px] leading-[1.2] font-bold text-fg">
                    {c.rotulo}
                  </span>
                  {c.nome !== c.rotulo && (
                    <span className="block truncate text-[11.5px] text-fg-4">{c.nome}</span>
                  )}
                </span>
                {c.isGoalkeeper && (
                  <Badge tom="warn">
                    <IconeLuva className="size-3" />
                    gol
                  </Badge>
                )}
                {/* O indicador repete o realce da linha — cor sozinha não pode
                    carregar a informação. */}
                <span
                  aria-hidden
                  className="size-[18px] shrink-0 rounded-full border-2 border-line-strong transition-colors peer-checked:border-accent-edge peer-checked:bg-accent"
                />
              </label>
            ))}
          </HairlineList>
        </div>
      )}

      {/* Não há banner de sucesso: enviar leva para a página do fut (ver
          enviarAvaliacoes). O aviso de que dá para mudar até o prazo acabar
          continua no rodapé aqui embaixo, que é onde ele é lido antes de
          enviar — e não depois. */}
      {state.error && <Banner tom="erro">{state.error}</Banner>}

      {/* Fica colado no rodapé porque a lista é longa e o botão não pode ficar
          só lá embaixo. O bottom desconta a faixa que a tab bar cobre — ela é
          `fixed` (ver tab-bar.tsx), então sem esse desconto o botão fica POR
          BAIXO das abas justamente na tela em que o toque importa. */}
      <div className="sticky bottom-[var(--tabbar-h,0px)] -mx-4 mt-2 flex flex-col gap-2 bg-gradient-to-t from-canvas from-70% px-4 pt-4 pb-3 lg:mx-0 lg:px-0">
        {etapa === "notas" && (
          <div className="flex items-center gap-2.5">
            <Meter
              valor={feitas}
              total={companheiros.length}
              rotulo={`${feitas} de ${companheiros.length} avaliados`}
            />
            <span className="shrink-0 font-display text-[11px] font-extrabold tracking-[.06em] text-fg-3 uppercase">
              {notasCompletas ? "tudo pronto" : `faltam ${companheiros.length - feitas}`}
            </span>
          </div>
        )}

        {etapa === "notas" && temEtapaMvp ? (
          <Button
            type="button"
            tamanho="lg"
            disabled={!notasCompletas}
            onClick={() => trocarEtapa("mvp")}
            className="w-full"
          >
            Continuar — falta o melhor em campo
          </Button>
        ) : (
          <div className="flex gap-2">
            {temEtapaMvp && (
              <Button
                type="button"
                variante="secondary"
                tamanho="lg"
                onClick={() => trocarEtapa("notas")}
              >
                Voltar
              </Button>
            )}
            <SubmitButton
              tamanho="lg"
              pending={pending}
              disabled={temEtapaMvp && voto === null}
              labelPending="Enviando…"
              className="flex-1"
            >
              {jaEnviou ? "Atualizar avaliação" : "Enviar avaliação"}
            </SubmitButton>
          </div>
        )}
        <p className="text-center text-[11.5px] leading-[1.45] text-fg-4">
          {etapa === "notas"
            ? "É tudo ou nada — ou vai todo mundo, ou não vai ninguém. Dá para voltar e mudar até o prazo acabar."
            : "Notas e voto vão juntos no enviar. Dá para voltar e mudar até o prazo acabar."}
        </p>
      </div>
    </form>
  );
}
