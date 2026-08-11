"use client";

import { useEffect, useRef } from "react";
import { varDoColete } from "@/lib/team-colors";
import { movimentoLigado } from "./comemoracao";

/**
 * O confete que cai quando os times aparecem.
 *
 * É o único lugar do app que ganha confete, e é de propósito: aqui ele carrega
 * informação — as cores são as dos coletes sorteados, então a chuva já conta de
 * quantos times o fut é antes de a pessoa ler qualquer coisa. Na confirmação de
 * presença fica só a bola: confete na interação mais repetida do app cansa em
 * uma semana.
 *
 * O pacote (~2,9 kB) entra por `import()` dentro do efeito. Quem nunca vê um
 * sorteio nunca o baixa, e o carregamento inicial do app não muda.
 */
export function ConfeteDoSorteio({ chave, times }: { chave: string; times: string[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Os nomes viram UMA string antes de chegar ao efeito, e o efeito depende
  // dela e não do array. `times` é montado no call site (`teamList.map(…)`),
  // então toda atualização do payload RSC entrega um array novo com o mesmo
  // conteúdo — e como a dependência mudava, o efeito se desmontava, chamava
  // `reset()` e matava a chuva no ar. Bastava confirmar presença nos ~3s do
  // confete para ele sumir e não voltar, porque a marca do sessionStorage faz a
  // re-execução desistir. String igual, dependência igual, chuva intacta.
  const nomes = times.join("|");

  useEffect(() => {
    if (!movimentoLigado()) return;

    // Uma vez por sorteio, por aba. Sem isto o confete cairia a cada volta à
    // página do fut — e a segunda vez já é enfeite, não notícia. sessionStorage
    // e não localStorage: reabrir o app semanas depois e rever os times daquele
    // dia não é o caso que interessa proteger.
    const marca = `futzenha:confete:${chave}`;
    if (sessionStorage.getItem(marca)) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const estilo = getComputedStyle(document.documentElement);
    const cores = nomes
      .split("|")
      .map((t) => varDoColete(t))
      .filter((v): v is string => v !== null)
      .map((v) => estilo.getPropertyValue(v).trim())
      .filter(Boolean);
    if (cores.length === 0) return;

    let cancelado = false;
    let encerrar: (() => void) | undefined;

    void import("canvas-confetti").then(({ default: confetti }) => {
      if (cancelado) return;
      sessionStorage.setItem(marca, "1");
      // Canvas próprio, e não o que a lib pendura sozinha no <body>: aqui a
      // gente controla o pointer-events (senão a folha invisível engole o
      // clique seguinte) e o desmonte. useWorker tira as partículas da main
      // thread, que é justamente a que está renderizando os cartões dos times.
      const disparar = confetti.create(canvas, { resize: true, useWorker: true });
      encerrar = () => disparar.reset();
      void disparar({ particleCount: 80, spread: 72, startVelocity: 38, origin: { y: 0.3 }, colors: cores });
    });

    return () => {
      cancelado = true;
      encerrar?.();
    };
  }, [chave, nomes]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      // z-40 acompanha a camada da comemoração: acima da TabBar e da TopBar
      // (z-30), abaixo do top layer do popover. `fixed` sem transform nenhum —
      // a armadilha do bloco contentor da nav não é acionada por posicionamento,
      // só por transform/filter/will-change.
      className="pointer-events-none fixed inset-0 z-40 size-full"
    />
  );
}
