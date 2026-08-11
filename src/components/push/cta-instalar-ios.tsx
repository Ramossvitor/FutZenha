"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ehIOS, emStandalone, gravarSnooze, snoozeVigente, useNoCliente } from "./ambiente";

const CHAVE_SNOOZE = "futzenha:cta-ios:snooze";
const DIAS_DE_SNOOZE = 14;

/**
 * Convite de instalação, só para iPhone/iPad no Safari.
 *
 * No iOS o push exige o app na Tela de Início — e o navegador não tem prompt de
 * instalação: o caminho é manual (Compartilhar → Adicionar à Tela de Início) e
 * alguém precisa contar isso para a pessoa. É este banner, ancorado logo acima
 * das abas em toda página, o lugar mais visto do app.
 *
 * Android e desktop nunca veem: lá o push funciona direto do site.
 *
 * Some de vez quando `instalado` (users.pwa_instalado_em, gravada pelo
 * DetectorStandalone) — clicar em "Como instalar" NÃO conta como instalar, só
 * silencia pelo snooze. As leituras de userAgent/localStorage acontecem no
 * render, guardadas pelo useNoCliente() (ver ambiente.ts): no servidor e na
 * hidratação o banner não existe, e o cliente o revela num re-render só.
 *
 * `aoRegistrarClique` é a Server Action injetada pelo layout — ver o comentário
 * do `aoSair` na Sidebar para o porquê de não importá-la aqui.
 */
export function CtaInstalarIos({
  instalado,
  aoRegistrarClique,
}: {
  instalado: boolean;
  aoRegistrarClique: () => Promise<void>;
}) {
  const noCliente = useNoCliente();
  const [dispensadoAgora, setDispensadoAgora] = useState(false);
  const [aberto, setAberto] = useState(false);

  if (!noCliente || instalado || dispensadoAgora) return null;
  if (!ehIOS() || emStandalone()) return null;
  if (snoozeVigente(CHAVE_SNOOZE, DIAS_DE_SNOOZE)) return null;

  return (
    <div className="sticky bottom-[var(--tabbar-h)] z-20 border-t border-line bg-surface-2 px-4 py-3 lg:hidden">
      <div className="mx-auto flex max-w-3xl flex-col gap-2">
        <div className="flex items-center gap-3">
          <p className="flex-1 text-[13px] leading-[1.45] text-fg-2">
            <span className="font-display font-bold text-fg">Instala o FutZenha</span> na tela de
            início e fica por dentro dos jogos.
          </p>
          <Button
            tamanho="sm"
            onClick={() => {
              setAberto((v) => !v);
              // Registrado no servidor: clicou-mas-não-instalou é o público que
              // o convite continua visando depois do snooze.
              aoRegistrarClique().catch(() => {});
            }}
          >
            Como instalar
          </Button>
          <button
            type="button"
            aria-label="Dispensar por enquanto"
            className="-m-2 p-2 text-fg-4 hover:text-fg-2"
            onClick={() => {
              gravarSnooze(CHAVE_SNOOZE);
              setDispensadoAgora(true);
            }}
          >
            ✕
          </button>
        </div>

        {aberto && (
          <ol className="flex list-decimal flex-col gap-1 pl-5 text-[12.5px] leading-[1.5] text-fg-2">
            <li>Toca em Compartilhar (o quadrado com a seta) na barra do Safari.</li>
            <li>Escolhe “Adicionar à Tela de Início”.</li>
            <li>
              Abre o app e entra na sua conta de novo — o app instalado não puxa o login do
              Safari.
            </li>
          </ol>
        )}
      </div>
    </div>
  );
}
