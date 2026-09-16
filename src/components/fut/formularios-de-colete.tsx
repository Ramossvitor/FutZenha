import type { ReactNode } from "react";
import { SubmitButton } from "@/components/ui/button";
import { CamposDoColete } from "@/components/ui/campos-do-colete";
import { IconeSeta } from "@/components/ui/icons";

/**
 * "Nome e cor dos times": um <details> fechado por padrão com um form por
 * time, para renomear e recolorir depois do sorteio. É o MESMO bloco no
 * /gerenciar (quem gerencia, via editarTimeAction) e no painel da súmula (quem
 * opera, via editarTimeNaSumula): a regra é uma só (src/lib/times-do-fut.ts),
 * e o bloco também — entre as duas telas só mudam a action, o prefixo dos ids,
 * a dica do cabeçalho e o rodapé. Fechado por padrão porque na maioria dos
 * futs os coletes do grupo já vêm certos do sorteio.
 *
 * Sem diretiva, como o CamposDoColete: no /gerenciar é server component, no
 * painel ("use client") entra no bundle do cliente. A action chega por uma
 * fábrica (`acaoDoTime(teamId)`), e não já bindada ao fut para ser bindada de
 * novo aqui: no cliente, o `.bind` de uma Server Action é o nativo — um
 * segundo bind perderia o registro da referência —, então cada tela faz o seu
 * único `.bind(null, matchDayId, teamId)`, como fazia antes de o bloco ser
 * compartilhado.
 */
export function FormulariosDeColete({
  times,
  acaoDoTime,
  idBase,
  dica,
  rodape,
}: {
  times: { id: number; nome: string; cor: string | null }[];
  /** A Server Action já bindada ao fut e a este time. */
  acaoDoTime: (teamId: number) => (formData: FormData) => Promise<void>;
  /** Prefixo dos ids dos campos — a página pode ter mais de um bloco. */
  idBase: string;
  /** O texto à direita do título, no <summary>. */
  dica: string;
  rodape: ReactNode;
}) {
  return (
    <details className="group rounded-card border border-line bg-surface">
      <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 font-display text-[13px] font-bold text-fg select-none">
        <IconeSeta className="size-4 shrink-0 text-fg-4 transition-transform group-open:rotate-90" />
        Nome e cor dos times
        <span className="ml-auto text-[12px] font-normal text-fg-4">{dica}</span>
      </summary>
      <div className="flex flex-col gap-5 border-t border-line p-4">
        {times.map((t) => (
          <form key={t.id} action={acaoDoTime(t.id)} className="flex flex-col gap-3">
            <fieldset className="flex flex-col gap-3">
              <legend className="mb-1 font-display text-[14px] font-extrabold font-stretch-112% text-fg">
                {t.nome}
              </legend>
              <CamposDoColete idBase={`${idBase}-${t.id}`} nome={t.nome} cor={t.cor} />
              <SubmitButton variante="secondary" tamanho="sm" className="self-start">
                Salvar
              </SubmitButton>
            </fieldset>
          </form>
        ))}
        <p className="text-[12px] leading-[1.45] text-fg-4">{rodape}</p>
      </div>
    </details>
  );
}
