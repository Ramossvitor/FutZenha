import { Badge } from "@/components/ui/badge";
import { SubmitButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader, Eyebrow } from "@/components/ui/card";
import type { SituacaoDoMultiplicador } from "@/lib/multiplicador-engine";
import { armarMultiplicador, desarmarMultiplicador } from "./actions";

/**
 * O card de armar o multiplicador, dentro da seção "Presença" do fut.
 *
 * Mora AQUI, e não no inventário, porque o gesto é sobre ESTE fut e o prazo é o
 * deste fut. Um seletor de futs dentro do inventário seria uma segunda lista de
 * futs, com regras próprias de o que aparece e o que não aparece — e ela
 * divergiria da primeira no dia em que uma das duas mudasse.
 *
 * O card some inteiro quando não há o que oferecer: sem item no inventário e
 * sem nada armado aqui, ele não tem o que dizer. Oferecer "compre um
 * multiplicador" na página do fut seria vender no meio da lista de presença.
 *
 * **Nada aqui é público.** O card só é renderizado para o dono, e nem a
 * contagem de quantos armaram aparece: durante a avaliação, saber de quem a
 * nota vai andar 1,5× é exatamente a pressão sobre o voto que o anonimato
 * (src/lib/anonimato.ts) existe para tirar da mesa.
 */
export function CardDoMultiplicador({
  matchDayId,
  situacao,
}: {
  matchDayId: number;
  situacao: SituacaoDoMultiplicador;
}) {
  const { armadoAqui, disponivel, aceita } = situacao;

  // Armado num fut que já começou: o card fica, sem botão. Some seria pior —
  // a pessoa apostou e precisa ver que a aposta está de pé.
  if (armadoAqui === null && (disponivel === null || !aceita)) return null;

  return (
    <Card>
      <CardHeader>
        <Eyebrow>multiplicador</Eyebrow>
        {armadoAqui !== null && <Badge tom="warn">armado</Badge>}
      </CardHeader>
      <CardBody>
        {armadoAqui !== null ? (
          <>
            <p className="text-[13px] leading-[1.5] text-fg-2">
              Sua nota vai andar mais neste fut — para cima <strong className="text-fg">e</strong>{" "}
              para baixo. Ninguém mais vê isto enquanto a avaliação estiver aberta.
            </p>
            {aceita ? (
              <form action={desarmarMultiplicador.bind(null, matchDayId, armadoAqui)}>
                <SubmitButton variante="secondary" tamanho="sm">
                  Desarmar
                </SubmitButton>
              </form>
            ) : (
              <p className="text-[12px] text-fg-4">
                A bola já rolou — não dá mais para desarmar. Desfazer a aposta depois de jogar
                seria decidir já sabendo o resultado.
              </p>
            )}
          </>
        ) : (
          <>
            <p className="text-[13px] leading-[1.5] text-fg-2">
              Você tem um multiplicador no inventário. Armado aqui, ele amplia o movimento da
              sua nota neste fut — nos dois sentidos.
            </p>
            <form action={armarMultiplicador.bind(null, matchDayId, disponivel!)}>
              <SubmitButton tamanho="sm">Armar neste fut</SubmitButton>
            </form>
            <p className="text-[12px] text-fg-4">
              Vale até o horário de início. Depois disso não dá mais para armar nem desarmar.
            </p>
          </>
        )}
      </CardBody>
    </Card>
  );
}
