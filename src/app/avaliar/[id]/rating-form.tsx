"use client";

import { useActionState, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { SubmitButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EstrelasInput } from "@/components/ui/estrelas-input";
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

export function RatingForm({
  roundId,
  companheiros,
  jaEnviou,
}: {
  roundId: number;
  companheiros: CompanheiroForm[];
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

  return (
    <form action={formAction} className="flex flex-col gap-2.5">
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

      {state.error && <Banner tom="erro">{state.error}</Banner>}
      {state.success && (
        <Banner tom="ok">Avaliação enviada. Dá para mudar enquanto o prazo não acabar.</Banner>
      )}

      {/* Fica colado no rodapé porque a lista é longa e o botão não pode ficar
          só lá embaixo. O bottom desconta a faixa que a tab bar cobre — ela é
          `fixed` (ver tab-bar.tsx), então sem esse desconto o botão fica POR
          BAIXO das abas justamente na tela em que o toque importa. */}
      <div className="sticky bottom-[var(--tabbar-h,0px)] -mx-4 mt-2 flex flex-col gap-2 bg-gradient-to-t from-canvas from-70% px-4 pt-4 pb-3 lg:mx-0 lg:px-0">
        <div className="flex items-center gap-2.5">
          <Meter
            valor={feitas}
            total={companheiros.length}
            rotulo={`${feitas} de ${companheiros.length} avaliados`}
          />
          <span className="shrink-0 font-display text-[11px] font-extrabold tracking-[.06em] text-fg-3 uppercase">
            {feitas === companheiros.length ? "tudo pronto" : `faltam ${companheiros.length - feitas}`}
          </span>
        </div>
        <SubmitButton tamanho="lg" pending={pending} labelPending="Enviando…" className="w-full">
          {jaEnviou ? "Atualizar avaliação" : `Enviar ${companheiros.length} avaliações`}
        </SubmitButton>
        <p className="text-center text-[11.5px] leading-[1.45] text-fg-4">
          É tudo ou nada — ou vai todo mundo, ou não vai ninguém. Dá para voltar e mudar até o prazo
          acabar.
        </p>
      </div>
    </form>
  );
}
