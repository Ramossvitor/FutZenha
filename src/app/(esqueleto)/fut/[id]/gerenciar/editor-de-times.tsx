"use client";

import {
  useEffect,
  useState,
  useSyncExternalStore,
  useTransition,
  type PointerEventHandler,
  type ReactNode,
} from "react";
import { SubmitButton } from "@/components/ui/button";
import { Card, CardHeader, Eyebrow } from "@/components/ui/card";
import { IconeAlca, IconeLuva } from "@/components/ui/icons";
import { Nota } from "@/components/ui/nota";
import { VestChip } from "@/components/ui/vest";
import { cx } from "@/lib/cx";
import { formatSkill } from "@/lib/format";
import {
  ladoPorJogadorDe,
  lerRascunho,
  repartirEmColunas,
  serializarRascunho,
  somaDeNotas,
  type ColunaDeTime,
  type JogadorDeTime,
} from "@/lib/montar-times";

// Movimento mínimo antes de o toque na alça virar arrasto — o mesmo valor do
// estrelas-input: abaixo disso é o tremor natural do dedo.
const FOLGA_DO_ARRASTO = 8;

type Modo =
  /** Lista aberta: as colunas são um rascunho no browser, e o form fecha a lista. */
  | "rascunho"
  /** Lista fechada: cada movimento grava na hora pela action `mover`. */
  | "gravado"
  /** Fut encerrado: só mostra. */
  | "leitura";

type Arrasto = {
  playerId: number;
  nome: string;
  origem: string | null;
  x0: number;
  y0: number;
  x: number;
  y: number;
  ativo: boolean;
  /** A coluna sob o ponteiro; `undefined` quando está fora de todas. */
  alvo: string | null | undefined;
};

// O rascunho do "montar" mora no localStorage e entra no React como store
// externo: é o único jeito de ler storage sem setState em efeito (o lint do
// React 19 proíbe) e sem divergir do servidor na hidratação — o snapshot do
// servidor é `null`, e o do cliente só é lido depois de montar.
const ouvintes = new Set<() => void>();
function assinarRascunho(cb: () => void) {
  ouvintes.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    ouvintes.delete(cb);
    window.removeEventListener("storage", cb);
  };
}
function lerDoStorage(chave: string): string | null {
  try {
    return localStorage.getItem(chave);
  } catch {
    return null;
  }
}
function gravarNoStorage(chave: string, valor: string | null) {
  try {
    if (valor === null) localStorage.removeItem(chave);
    else localStorage.setItem(chave, valor);
  } catch {
    // Storage bloqueado: o rascunho vive só nesta página — ainda funciona,
    // porque os movimentos também ficam nos `ajustes` locais.
  }
  for (const cb of ouvintes) cb();
}

/** A coluna sob o ponto da tela; `undefined` fora de todas, `null` = "Sem time". */
function colunaNoPonto(x: number, y: number): string | null | undefined {
  const el = document
    .elementFromPoint(x, y)
    ?.closest<HTMLElement>("[data-coluna]");
  if (!el) return undefined;
  return el.dataset.coluna === "" ? null : el.dataset.coluna;
}

/**
 * O editor de times: uma coluna "Sem time" e uma por time, com os jogadores
 * movendo entre elas por arrasto (alça ⋮⋮, dedo ou mouse) ou pelos
 * botõezinhos de colete ao lado do nome. É um só componente para os dois
 * momentos — montar antes de fechar a lista e ajustar depois — porque a
 * interação é idêntica; só muda quem grava.
 *
 * O gesto é pointer events à mão, no padrão do estrelas-input: nada de lib.
 * A alça tem `touch-none` para o arrasto começar no primeiro pixel, sem
 * long-press; o resto da linha fica livre para a página rolar normalmente. O
 * alvo é achado por `elementFromPoint` a cada movimento — o fantasma que segue
 * o ponteiro é `pointer-events-none` justamente para não se achar a si mesmo.
 *
 * As colunas são sempre DERIVADAS: o que vem do servidor, mais o rascunho do
 * storage (modo rascunho), mais os `ajustes` otimistas desta sessão. Toda vez
 * que o servidor re-renderiza, `colunas` chega como um array novo e os ajustes
 * são zerados: depois de uma gravação bem-sucedida o dado real já é igual ao
 * palpite (nada pisca); depois de uma recusa (redirect com ?erro=) ele é o
 * estado antigo, e a linha volta para onde estava. Sem `useOptimistic` — ver
 * o motivo em sumula/painel.tsx.
 */
export function EditorDeTimes({
  futId,
  modo,
  colunas: doServidor,
  mover,
  fecharLista,
}: {
  futId: number;
  modo: Modo;
  colunas: ColunaDeTime[];
  /** Modo gravado: a action já com o id do fut aplicado. */
  mover?: (playerId: number, teamId: number | null) => Promise<void>;
  /** Modo rascunho: a action do form que fecha a lista. */
  fecharLista?: (formData: FormData) => Promise<void>;
}) {
  const chaveDoRascunho = `futzenha:montar:${futId}`;
  const [ajustes, setAjustes] = useState<Map<number, string | null>>(new Map());
  // Quem está com a action em voo (modo gravado). É um Set, e não um id só:
  // dois toques seguidos são dois requests, e o primeiro a voltar não pode
  // apagar o `aria-busy` nem o palpite do segundo.
  const [emVoo, setEmVoo] = useState<ReadonlySet<number>>(new Set());
  const [base, setBase] = useState(doServidor);
  // Zera os ajustes quando o servidor manda colunas novas — no render, que é
  // como o React pede para derivar estado de prop (não em efeito). Fica só o
  // palpite de quem ainda está em voo: essas colunas são a resposta de OUTRO
  // movimento, e a dele ainda vem.
  if (base !== doServidor) {
    setBase(doServidor);
    setAjustes(new Map([...ajustes].filter(([id]) => emVoo.has(id))));
  }
  const rascunhoSalvo = useSyncExternalStore(
    assinarRascunho,
    () => (modo === "rascunho" ? lerDoStorage(chaveDoRascunho) : null),
    () => null,
  );
  const [arrasto, setArrasto] = useState<Arrasto | null>(null);
  const [, startTransition] = useTransition();

  // Lista fechada: o rascunho já cumpriu o papel (ou foi atropelado por um
  // sorteio) e não pode reaparecer num fut futuro com o mesmo id.
  useEffect(() => {
    if (modo !== "rascunho") gravarNoStorage(chaveDoRascunho, null);
  }, [modo, chaveDoRascunho]);

  // Autoscroll de borda: no celular as colunas empilham, e com 15 confirmados
  // o time de destino fica fora da tela. Com o dedo parado perto da borda a
  // página anda sozinha — e o alvo é recalculado a cada passo, porque sem
  // pointermove o `alvo` guardado ficaria apontando para o que passou.
  const arrastoAtivo = arrasto?.ativo ?? false;
  const arrastoY = arrasto?.y ?? 0;
  useEffect(() => {
    if (!arrastoAtivo) return;
    const margem = 72;
    const passo = 14;
    const dy =
      arrastoY < margem
        ? -passo
        : arrastoY > window.innerHeight - margem
          ? passo
          : 0;
    if (dy === 0) return;
    const id = setInterval(() => {
      window.scrollBy(0, dy);
      setArrasto((a) => (a ? { ...a, alvo: colunaNoPonto(a.x, a.y) } : a));
    }, 16);
    return () => clearInterval(id);
  }, [arrastoAtivo, arrastoY]);

  const jogadores = doServidor.flatMap((c) => c.jogadores);
  const times = doServidor
    .filter((c) => c.chave !== null)
    .map((c) => ({ chave: c.chave!, nome: c.nome }));
  const ladoPorJogador = ladoPorJogadorDe(doServidor);
  if (modo === "rascunho") {
    for (const [id, lado] of lerRascunho(rascunhoSalvo)) {
      if (ladoPorJogador.has(id)) ladoPorJogador.set(id, lado);
    }
  }
  for (const [id, lado] of ajustes) ladoPorJogador.set(id, lado);
  const colunas = repartirEmColunas(jogadores, times, ladoPorJogador);

  const aplicar = (playerId: number, destino: string | null) => {
    if (!times.some((t) => t.chave === destino) && destino !== null) return;
    if ((ladoPorJogador.get(playerId) ?? null) === destino) return;
    const proximos = new Map(ajustes).set(playerId, destino);
    setAjustes(proximos);
    if (modo === "rascunho") {
      const completo = new Map(ladoPorJogador);
      for (const [id, lado] of proximos) completo.set(id, lado);
      gravarNoStorage(chaveDoRascunho, serializarRascunho(completo));
    } else if (modo === "gravado" && mover) {
      setEmVoo((v) => new Set(v).add(playerId));
      startTransition(async () => {
        try {
          await mover(playerId, destino === null ? null : Number(destino));
        } finally {
          // Voltou (gravado ou recusado): o servidor passa a mandar nesta
          // linha — o palpite sai junto com o `aria-busy`.
          setEmVoo((v) => {
            const proximo = new Set(v);
            proximo.delete(playerId);
            return proximo;
          });
          setAjustes((a) => {
            const proximo = new Map(a);
            proximo.delete(playerId);
            return proximo;
          });
        }
      });
    }
  };

  const editavel = modo !== "leitura";
  const destinos = colunas.map((c) => ({ chave: c.chave, nome: c.nome }));
  // Em leitura a coluna "Sem time" só aparece se tiver alguém.
  const visiveis = colunas.filter(
    (c) => c.chave !== null || editavel || c.jogadores.length > 0,
  );

  const grade = (
    <div className="grid gap-3 sm:grid-cols-2">
      {visiveis.map((coluna) => {
        const soma = somaDeNotas(coluna.jogadores);
        const vazia = coluna.jogadores.length === 0;
        const alvoAtual = arrasto?.ativo && arrasto.alvo === coluna.chave;
        const semTime = coluna.chave === null;
        return (
          // O div por fora, e não o atributo no Card: o Card só aceita
          // className/style, e é este `data-coluna` que o elementFromPoint
          // procura. Vazio = "Sem time".
          <div
            key={coluna.chave ?? "sem-time"}
            data-coluna={coluna.chave ?? ""}
            // O destaque também vai como atributo: é o sinal que o E2E espera
            // antes de soltar, em vez de adivinhar pela posição do ponteiro.
            data-alvo={alvoAtual || undefined}
            className={cx(
              // Fechada e sem ninguém de fora, "Sem time" é só um alvo de
              // soltar, discreto, atravessando a grade.
              semTime && vazia && modo === "gravado" && "sm:col-span-2",
            )}
          >
            <Card
              className={cx(
                "h-full transition-[box-shadow,border-color] duration-150",
                semTime && "border-dashed",
                alvoAtual && "border-accent-edge ring-2 ring-accent-edge",
              )}
            >
              <CardHeader>
                {!semTime && <VestChip time={coluna.nome} tamanho="lg" />}
                <span className="flex flex-1 items-baseline gap-2">
                  <span className="font-display text-[15px] font-extrabold font-stretch-112% text-fg">
                    {coluna.nome}
                  </span>
                  <span
                    className="font-display text-[12px] font-bold text-fg-4"
                    data-num
                  >
                    {coluna.jogadores.length}
                  </span>
                </span>
                {!semTime && (
                  <span className="text-right">
                    <Eyebrow>soma · média</Eyebrow>
                    <span
                      className="block font-display text-[13px] font-bold text-fg-2"
                      data-num
                    >
                      {formatSkill(soma)} ·{" "}
                      {formatSkill(soma / Math.max(coluna.jogadores.length, 1))}
                    </span>
                  </span>
                )}
              </CardHeader>
              {vazia ? (
                <p className="px-4 py-3 text-[12px] text-fg-4">
                  {editavel
                    ? semTime
                      ? "Arraste aqui para tirar alguém do time."
                      : "Arraste alguém para cá."
                    : "Ninguém."}
                </p>
              ) : (
                <ul className="flex flex-col">
                  {coluna.jogadores.map((j) => (
                    <Linha
                      key={j.playerId}
                      jogador={j}
                      editavel={editavel}
                      arrastando={
                        arrasto?.ativo === true &&
                        arrasto.playerId === j.playerId
                      }
                      emVoo={emVoo.has(j.playerId)}
                      destinos={destinos.filter(
                        (d) => d.chave !== coluna.chave,
                      )}
                      aoMandar={(destino) => aplicar(j.playerId, destino)}
                      aoPegar={(e) => {
                        if (e.pointerType === "mouse" && e.button !== 0) return;
                        e.currentTarget.setPointerCapture(e.pointerId);
                        setArrasto({
                          playerId: j.playerId,
                          nome: j.nome,
                          origem: coluna.chave,
                          x0: e.clientX,
                          y0: e.clientY,
                          x: e.clientX,
                          y: e.clientY,
                          ativo: false,
                          alvo: undefined,
                        });
                      }}
                      aoMover={(e) => {
                        if (!arrasto || arrasto.playerId !== j.playerId) return;
                        // Ponteiro sem contato (mouse que soltou fora, caneta
                        // pairando): encerra sem soltar em lugar nenhum.
                        if (e.buttons === 0) {
                          setArrasto(null);
                          return;
                        }
                        const ativo =
                          arrasto.ativo ||
                          Math.hypot(
                            e.clientX - arrasto.x0,
                            e.clientY - arrasto.y0,
                          ) >= FOLGA_DO_ARRASTO;
                        if (!ativo) return;
                        setArrasto({
                          ...arrasto,
                          ativo: true,
                          x: e.clientX,
                          y: e.clientY,
                          alvo: colunaNoPonto(e.clientX, e.clientY),
                        });
                      }}
                      aoSoltar={() => {
                        if (!arrasto || arrasto.playerId !== j.playerId) return;
                        if (
                          arrasto.ativo &&
                          arrasto.alvo !== undefined &&
                          arrasto.alvo !== arrasto.origem
                        ) {
                          aplicar(j.playerId, arrasto.alvo);
                        }
                        setArrasto(null);
                      }}
                      aoCancelar={() => setArrasto(null)}
                    />
                  ))}
                </ul>
              )}
            </Card>
          </div>
        );
      })}
    </div>
  );

  const fantasma = arrasto?.ativo && (
    <div
      aria-hidden
      className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-1/2 rounded-ctl border border-accent-edge bg-surface px-3 py-1.5 font-display text-[14px] font-bold text-fg shadow-lg"
      style={{ left: arrasto.x, top: arrasto.y }}
    >
      {arrasto.nome}
    </div>
  );

  if (modo === "rascunho") {
    // Os lados viram campos escondidos: o form é o mesmo <form action> de todo
    // o app, e o submit é o único momento em que o rascunho chega ao servidor.
    const lados = colunas.filter((c) => c.chave !== null);
    const faltam = colunas[0].jogadores.length;
    return (
      <form action={fecharLista} className="flex flex-col gap-3">
        {grade}
        {fantasma}
        {lados.flatMap((c) =>
          c.jogadores.map((j) => (
            <input
              key={j.playerId}
              type="hidden"
              name={`lado-${j.playerId}`}
              value={c.chave!}
            />
          )),
        )}
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton labelPending="Fechando…">
            Fechar lista com esses times
          </SubmitButton>
          <span className="text-[12px] text-fg-4">
            {faltam > 0
              ? `${faltam} sem time — todo confirmado precisa de um`
              : "fechar trava a lista: daqui em diante quem inclui é você"}
          </span>
        </div>
      </form>
    );
  }

  return (
    <>
      {grade}
      {fantasma}
    </>
  );
}

function Linha({
  jogador,
  editavel,
  arrastando,
  emVoo,
  destinos,
  aoMandar,
  aoPegar,
  aoMover,
  aoSoltar,
  aoCancelar,
}: {
  jogador: JogadorDeTime;
  editavel: boolean;
  arrastando: boolean;
  emVoo: boolean;
  destinos: { chave: string | null; nome: string }[];
  aoMandar: (destino: string | null) => void;
  aoPegar: PointerEventHandler<HTMLButtonElement>;
  aoMover: PointerEventHandler<HTMLButtonElement>;
  aoSoltar: PointerEventHandler<HTMLButtonElement>;
  aoCancelar: PointerEventHandler<HTMLButtonElement>;
}) {
  return (
    <li
      aria-busy={emVoo || undefined}
      className={cx(
        "flex items-center gap-2 border-b border-line-soft py-1.5 pr-2 pl-1 last:border-0",
        (arrastando || emVoo) && "opacity-40",
      )}
    >
      {editavel ? (
        // A alça: `touch-none` aqui e só aqui — é o que faz o arrasto começar
        // sem long-press no celular, enquanto o resto da linha ainda rola.
        <button
          type="button"
          aria-label={`Arrastar ${jogador.nome}`}
          onPointerDown={aoPegar}
          onPointerMove={aoMover}
          onPointerUp={aoSoltar}
          onPointerCancel={aoCancelar}
          className="flex size-9 shrink-0 cursor-grab touch-none items-center justify-center rounded-ctl text-fg-4 select-none hover:bg-surface-2 hover:text-fg-2 active:cursor-grabbing"
        >
          <IconeAlca className="size-4" />
        </button>
      ) : (
        <span className="w-3 shrink-0" />
      )}
      {jogador.isGoalkeeper && (
        <span title="goleiro">
          <IconeLuva className="size-4 shrink-0 text-warn-ink" />
          <span className="sr-only">goleiro</span>
        </span>
      )}
      <span className="min-w-0 flex-1 truncate font-display text-[14px] font-bold text-fg">
        {jogador.nome}
      </span>
      <Nota valor={jogador.skill} tamanho="sm" />
      {editavel && (
        <span className="ml-1 flex shrink-0 items-center gap-1">
          {destinos.map((d) => (
            <BotaoDeDestino
              key={d.chave ?? "sem-time"}
              rotulo={
                d.chave === null
                  ? `Tirar ${jogador.nome} do time`
                  : `Mandar ${jogador.nome} para o ${d.nome}`
              }
              onClick={() => aoMandar(d.chave)}
            >
              {d.chave === null ? (
                <span
                  aria-hidden
                  className="text-[16px] leading-none text-fg-3"
                >
                  ×
                </span>
              ) : (
                <VestChip time={d.nome} tamanho="md" />
              )}
            </BotaoDeDestino>
          ))}
        </span>
      )}
    </li>
  );
}

/** O botãozinho de "manda para o X": 36px de alvo de toque, colete dentro. */
function BotaoDeDestino({
  rotulo,
  onClick,
  children,
}: {
  rotulo: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={rotulo}
      title={rotulo}
      onClick={onClick}
      className="flex size-9 items-center justify-center rounded-ctl border border-line-strong bg-transparent transition-colors hover:border-line-hover hover:bg-surface-2"
    >
      {children}
    </button>
  );
}
