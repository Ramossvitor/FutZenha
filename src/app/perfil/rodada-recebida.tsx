import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, Eyebrow } from "@/components/ui/card";
import { Estrelas } from "@/components/ui/estrelas";
import { HairlineList, HairlineRow } from "@/components/ui/hairline-list";
import { cx } from "@/lib/cx";
import { formatDateShort, formatSkill } from "@/lib/format";
import type { RodadaAvaliada } from "@/lib/ratings";
import { DenunciarForm } from "./denunciar-form";

const SELO = {
  open: { tom: "warn", texto: "em análise" },
  accepted: { tom: "neutral", texto: "descartada" },
  rejected: { tom: "neutral", texto: "considerada justa" },
} as const;

/**
 * Uma rodada de avaliação recebida, na forma de distribuição.
 *
 * Mostrar as estrelas soltas, uma embaixo da outra, transforma cinco
 * avaliações em cinco suspeitos — e a fila de linhas convida a montar teoria
 * sobre quem deu o quê. O histograma entrega exatamente a mesma informação
 * (quantas notas, e quais) como um retrato da rodada.
 *
 * A contestação continua sendo por avaliação específica, porque é assim que o
 * backend registra (roundId + índice). Ela mora atrás de um <details>: quem
 * quer contestar abre e escolhe qual, e quem só quer ver o resultado não
 * esbarra na lista. Sem JavaScript.
 */
export function RodadaRecebida({ rodada }: { rodada: RodadaAvaliada }) {
  const validas = rodada.estrelas.filter((e) => !e.descartada);
  const contagem = [5, 4, 3, 2, 1].map((n) => ({
    n,
    quantas: validas.filter((e) => e.stars === n).length,
  }));
  const maior = Math.max(1, ...contagem.map((c) => c.quantas));

  const delta =
    rodada.skillBefore !== null && rodada.skillAfter !== null
      ? rodada.skillAfter - rodada.skillBefore
      : null;

  const contestaveis = rodada.estrelas.filter(
    (e) => rodada.podeDenunciar && e.denunciaStatus === null && !e.descartada,
  );

  return (
    <Card>
      <CardHeader className="flex-col items-start gap-1">
        <Eyebrow>rodada · {formatDateShort(rodada.matchDayDate)}</Eyebrow>
        {rodada.skillBefore !== null && rodada.skillAfter !== null && (
          <span className="flex items-baseline gap-2" data-num>
            <span className="font-display text-[18px] font-extrabold text-fg-4">
              {formatSkill(rodada.skillBefore)}
            </span>
            <span aria-hidden className="text-fg-4">
              →
            </span>
            <span className="font-display text-[26px] leading-none font-black font-stretch-125% text-fg">
              {formatSkill(rodada.skillAfter)}
            </span>
            {delta !== null && delta !== 0 && (
              <span
                className={cx(
                  "font-display text-[12px] font-extrabold",
                  delta > 0 ? "text-accent-ink" : "text-danger-ink",
                )}
              >
                {delta > 0 ? "+" : "−"}
                {formatSkill(Math.abs(delta))}
              </span>
            )}
          </span>
        )}
      </CardHeader>

      <div className="flex flex-col gap-2 p-4">
        <Eyebrow>
          o que você recebeu · {validas.length}{" "}
          {validas.length === 1 ? "avaliação" : "avaliações"}
        </Eyebrow>

        {contagem.map(({ n, quantas }) => (
          <div key={n} className="flex items-center gap-2.5">
            <Estrelas valor={n} className="w-[5.5rem] shrink-0 [&>span]:size-3" />
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-line-soft">
              <div
                className={cx("h-full rounded-full", quantas > 0 ? "bg-accent" : "bg-transparent")}
                style={{ width: `${(quantas / maior) * 100}%` }}
              />
            </div>
            <span
              className={cx(
                "w-4 text-right font-display text-[13px] font-extrabold",
                quantas > 0 ? "text-fg" : "text-fg-faint",
              )}
              data-num
            >
              {quantas}
            </span>
          </div>
        ))}

        {rodada.estrelas.some((e) => e.descartada || e.denunciaStatus !== null) && (
          <p className="mt-1 text-[11.5px] leading-[1.45] text-fg-4">
            Avaliação descartada por denúncia aceita não entra na conta acima nem na nota.
          </p>
        )}
      </div>

      {contestaveis.length > 0 && (
        <details className="border-t border-line">
          <summary className="cursor-pointer list-none px-4 py-3 text-center font-display text-[12px] font-bold tracking-[.04em] text-fg-3 uppercase transition-colors hover:text-danger-ink">
            Contestar uma nota desta rodada
          </summary>
          <div className="flex flex-col gap-2.5 px-4 pt-1 pb-4">
            <p className="text-[12px] leading-[1.5] text-fg-4">
              Escolha qual. Vale uma por rodada, e a ordem abaixo é embaralhada de propósito — ela
              não diz quem deu o quê.
            </p>
            <HairlineList as="ul">
              {rodada.estrelas.map((e) => (
                <HairlineRow as="li" key={e.indice} apagado={e.descartada}>
                  <Estrelas valor={e.stars} />
                  <span className="flex-1" />
                  {e.descartada && <Badge tom="neutral">descartada</Badge>}
                  {e.denunciaStatus && (
                    <Badge tom={SELO[e.denunciaStatus].tom}>{SELO[e.denunciaStatus].texto}</Badge>
                  )}
                  {rodada.podeDenunciar && e.denunciaStatus === null && !e.descartada && (
                    <DenunciarForm roundId={rodada.roundId} indice={e.indice} />
                  )}
                </HairlineRow>
              ))}
            </HairlineList>
          </div>
        </details>
      )}
    </Card>
  );
}
