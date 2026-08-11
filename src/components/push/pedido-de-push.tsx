"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ehIOS, emStandalone, gravarSnooze, snoozeVigente, useNoCliente } from "./ambiente";
import { usePush, type AcoesDePush } from "./use-push";

const CHAVE_SNOOZE = "futzenha:push:snooze";
const DIAS_DE_SNOOZE = 30;

type Contexto = "confirmado" | "espera" | "avisos";

// O que cada contexto promete — o pedido só convence se falar do momento em
// que a pessoa está, não de "notificações" em abstrato.
const COPY: Record<Contexto, string> = {
  espera: "Você está na espera — ativa os avisos e a gente te chama na hora se abrir vaga.",
  confirmado: "Presença confirmada — ativa os avisos para saber quando os times saírem.",
  avisos: "Ativa os avisos no aparelho e fica sabendo das novidades sem precisar abrir o site.",
};

/**
 * Pré-prompt de push: um banner nosso ANTES do prompt nativo, mostrado só nos
 * momentos em que o aviso tem valor óbvio (confirmou presença, caiu na espera,
 * abriu a caixa de avisos) — nunca no load de uma página qualquer.
 *
 * O prompt nativo só dispara no clique de "Ativar" — no iOS é exigência, no
 * Chrome é o que evita o bloqueio automático por pedido fora de gesto. Regras
 * de silêncio, nesta ordem:
 * - sem suporte (inclui iOS Safari fora do app instalado — lá quem convida é o
 *   CtaInstalarIos, pedir permissão aqui seria beco sem saída) e sem VAPID;
 * - permissão já decidida no nativo: "granted" dispensa o convite e "denied"
 *   NUNCA é re-pedido — o caminho de volta é manual e mora no /perfil;
 * - este device já assinado;
 * - "Agora não" recente (30 dias, por device).
 *
 * As leituras de ambiente (userAgent, localStorage) acontecem no render,
 * guardadas pelo useNoCliente() — ver o comentário dele em ambiente.ts.
 */
export function PedidoDePush({ contexto, acoes }: { contexto: Contexto; acoes: AcoesDePush }) {
  const { suportado, permissao, inscritoNesteDevice, ativar } = usePush(acoes);
  const noCliente = useNoCliente();
  const [dispensadoAgora, setDispensadoAgora] = useState(false);
  const [estado, setEstado] = useState<"parado" | "ativando" | "falhou">("parado");

  if (!noCliente || !suportado || inscritoNesteDevice || dispensadoAgora) return null;
  if (permissao === "denied" || permissao === "granted") return null;
  if (ehIOS() && !emStandalone()) return null;
  if (snoozeVigente(CHAVE_SNOOZE, DIAS_DE_SNOOZE)) return null;

  return (
    <div className="flex flex-col gap-2 rounded-ctl border border-accent-line bg-accent-tint px-3.5 py-2.5 sm:flex-row sm:items-center">
      <p className="flex-1 text-[13px] leading-[1.5] text-accent-ink">
        {estado === "falhou"
          ? "Não deu para ativar os avisos — tenta de novo no seu perfil."
          : COPY[contexto]}
      </p>
      <span className="flex shrink-0 gap-1.5">
        <Button
          tamanho="sm"
          pending={estado === "ativando"}
          onClick={async () => {
            setEstado("ativando");
            const resultado = await ativar();
            if (resultado === "erro") setEstado("falhou");
            else setEstado("parado");
            // "negado" some sozinho: o hook atualiza `permissao` e o banner
            // deixa de renderizar — insistir depois de um "não" nativo é spam.
          }}
        >
          Ativar avisos
        </Button>
        <Button
          variante="secondary"
          tamanho="sm"
          onClick={() => {
            gravarSnooze(CHAVE_SNOOZE);
            setDispensadoAgora(true);
          }}
        >
          Agora não
        </Button>
      </span>
    </div>
  );
}
