import { definirMovimento } from "./actions";
import { SubmitButton } from "@/components/ui/button";
import { Card, CardBody, Section } from "@/components/ui/card";
import { getMovimento, type Movimento } from "@/lib/movimento";

const OPCOES: { valor: Movimento; rotulo: string }[] = [
  { valor: "auto", rotulo: "Automático" },
  { valor: "ligado", rotulo: "Ligadas" },
  { valor: "reduzido", rotulo: "Desligadas" },
];

const EXPLICACAO: Record<Movimento, string> = {
  auto: "Seguindo o seu aparelho: se você ligou “reduzir movimento” nos ajustes do sistema, aqui elas ficam desligadas também.",
  ligado: "As animações rodam mesmo que o seu aparelho peça para reduzir movimento.",
  reduzido: "Sem bola comemorando, sem cascata nos times. Nada muda de lugar, e o app fica mais leve em aparelho apertado.",
};

/**
 * A saída de emergência do movimento — e ela existe porque animação é a
 * primeira coisa a engasgar em aparelho apertado, e a última que alguém quer
 * ter que aguentar sem poder desligar.
 *
 * Server Component com três <form>: sem client state, sem JS, e a escolha fica
 * salva no cookie. Um <select> ou um checkbox controlado precisariam de
 * "use client" e de um handler para aplicar o valor — três botões dizem a mesma
 * coisa e continuam funcionando com o JS desligado, como o resto do app.
 *
 * "Automático" no meio da lista seria mais bonito e mais errado: a ordem aqui é
 * a do padrão para o mais restritivo, e o padrão vem primeiro.
 */
export async function MovimentoToggle() {
  const atual = await getMovimento();

  return (
    <Section titulo="Animações">
      <Card>
        <CardBody className="flex flex-col gap-3">
          <p className="text-[13px] leading-[1.5] text-fg-2">{EXPLICACAO[atual]}</p>
          <div className="flex flex-wrap gap-2">
            {OPCOES.map(({ valor, rotulo }) => (
              <form key={valor} action={definirMovimento.bind(null, valor)}>
                <SubmitButton
                  variante={valor === atual ? "primary" : "secondary"}
                  tamanho="sm"
                  // A escolha vigente segue sendo um botão de verdade, e não um
                  // disabled: reenviá-la é inofensivo, e desabilitar tiraria o
                  // foco de quem navega por teclado no exato item em que ele
                  // está — o mesmo motivo que o aria-live do Button documenta.
                  aria-pressed={valor === atual}
                >
                  {rotulo}
                </SubmitButton>
              </form>
            ))}
          </div>
        </CardBody>
      </Card>
    </Section>
  );
}
