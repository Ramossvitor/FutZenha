import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { HairlineList, HairlineRow } from "@/components/ui/hairline-list";
import { IconeLuva } from "@/components/ui/icons";
import { VestChip } from "@/components/ui/vest";
import type { JogoDoResumo, ResumoDoFut } from "@/lib/resumo";

// Como o fut terminou, em bloco reaproveitável: placar de cada jogo com os gols
// embaixo, artilharia do dia e os elencos.
//
// Server Component sem estado — o resumo chega pronto de src/lib/resumo-do-fut.
// Existe porque a tela de avaliação passou a mostrar o mesmo que a página do fut
// já mostrava, e a alternativa era a terceira cópia da regra do colete de cada
// gol (a primeira é a página, a segunda é o e-mail).

/**
 * Um jogo: placar, coletes e os gols embaixo.
 *
 * Exportado à parte do `ResumoDoFutView` porque a página do fut mostra ESTE
 * pedaço e mais nada daqui — ela já tem seção de times própria e não tem
 * artilharia. Enquanto ele morava só dentro do bloco inteiro, a página mantinha
 * uma cópia literal da marcação, que é o que este arquivo veio desfazer.
 */
export function CartaoDeJogo({ jogo }: { jogo: JogoDoResumo }) {
  return (
    <Card className="p-3.5">
      {/* Transparência da súmula ao vivo: o placar parcial é público desde o
          primeiro gol — todo mundo vê na hora se alguém inventar. Atualiza no
          puxar-para-atualizar. */}
      {jogo.emAndamento && (
        <div className="mb-2 flex justify-center">
          <Badge tom="accent" ponto>
            em andamento
          </Badge>
        </div>
      )}
      <div className="flex items-center gap-3">
        <span className="flex flex-1 items-center justify-end gap-2">
          <span className="truncate font-display text-[12px] font-bold text-fg-2">
            {jogo.timeA}
          </span>
          <VestChip time={jogo.timeA} />
        </span>
        <span
          className="font-display text-[26px] leading-none font-black font-stretch-125% text-fg"
          data-num
        >
          {jogo.placarA} × {jogo.placarB}
        </span>
        <span className="flex flex-1 items-center gap-2">
          <VestChip time={jogo.timeB} />
          <span className="truncate font-display text-[12px] font-bold text-fg-2">
            {jogo.timeB}
          </span>
        </span>
      </div>

      {jogo.gols.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1.5 border-t border-line-soft pt-2.5">
          {/* O colete é o do lado em que a pessoa jogou NESTE jogo — é o que
              permite ler de relance para que lado foi o gol. Quem resolve os
              fallbacks (gol sem autor, e quem marcou sem linha de escalação) é o
              montarResumo, não esta tela. */}
          {jogo.gols.map((gol, i) => (
            <li key={i} className="flex items-center gap-2">
              <VestChip time={gol.time} tamanho="sm" />
              <span
                className={`flex-1 truncate text-[12.5px] ${
                  gol.autor === null ? "text-fg-4 italic" : "text-fg-2"
                }`}
              >
                {gol.autor ?? "Gol contra / sem autor"}
              </span>
              <span className="font-display text-[12px] font-extrabold text-fg" data-num>
                {gol.quantidade}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function ResumoDoFutView({
  resumo,
  meuPlayerId = null,
}: {
  resumo: ResumoDoFut;
  /** Só para destacar a própria linha na artilharia. */
  meuPlayerId?: number | null;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2.5">
        {resumo.jogos.map((jogo) => (
          <CartaoDeJogo key={jogo.id} jogo={jogo} />
        ))}
      </div>

      {resumo.artilheiros.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="font-display text-[11px] font-extrabold tracking-[.06em] text-fg-3 uppercase">
            Artilharia do dia
          </span>
          <HairlineList as="ul">
            {resumo.artilheiros.map((artilheiro) => (
              <HairlineRow
                as="li"
                key={artilheiro.playerId}
                destaque={artilheiro.playerId === meuPlayerId}
              >
                <span className="min-w-0 flex-1 truncate font-display text-[14px] font-bold text-fg">
                  {artilheiro.rotulo}
                </span>
                <span className="font-display text-[13px] font-extrabold text-fg" data-num>
                  {artilheiro.gols}
                </span>
              </HairlineRow>
            ))}
          </HairlineList>
        </div>
      )}

      {resumo.times.length > 0 && (
        <div className="grid gap-2.5 sm:grid-cols-2">
          {resumo.times.map((time) => (
            <Card key={time.id} className="p-3.5">
              <div className="mb-2 flex items-center gap-2">
                <VestChip time={time.nome} />
                <span className="flex-1 truncate font-display text-[14px] font-extrabold font-stretch-112% text-fg">
                  {time.nome}
                </span>
              </div>
              <ul className="flex flex-col gap-1">
                {time.jogadores.map((jogador) => (
                  <li key={jogador.playerId} className="flex items-center gap-1.5">
                    {jogador.isGoalkeeper && (
                      <span title="goleiro">
                        <IconeLuva className="size-3.5 shrink-0 text-warn-ink" />
                        <span className="sr-only">goleiro</span>
                      </span>
                    )}
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg-2">
                      {jogador.rotulo}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
