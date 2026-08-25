import { Badge } from "@/components/ui/badge";
import { SubmitButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader, Eyebrow } from "@/components/ui/card";
import type { SituacaoDaAposta } from "@/lib/aposta-engine";
import { apostarAction, cancelarApostaAction } from "./aposta-actions";

/**
 * O card da aposta, na seção "Presença" do fut.
 *
 * Mora aqui pelo mesmo motivo do card do multiplicador: o gesto é sobre ESTE
 * fut e o prazo é o deste fut. E vem antes da lista, porque o corte é ainda mais
 * cedo — a aposta fecha quando os times saem, então quem visse o card depois de
 * vinte nomes o veria pela primeira vez já fora do prazo.
 *
 * **O pote é público, as apostas não.** A soma do que está em jogo aparece para
 * quem vê o card — antes de apostar inclusive, porque é ela que diz se vale a
 * pena entrar e quanto o prêmio pode valer. O que não aparece é quem apostou
 * quanto: o mercado é "todo mundo na própria vitória", e mostrar nome por nome
 * só serviria para cobrança de quem jogou mal. Mostrar o total não entrega nada
 * — a aposta é cega dos dois lados, e ninguém escolhe lado nenhum.
 */
export function CardDaAposta({
  matchDayId,
  situacao,
}: {
  matchDayId: number;
  situacao: SituacaoDaAposta;
}) {
  const { minha, resolvida, confirmado, aceita, pote, apostaMin, apostaMax } = situacao;

  // Sem nada a dizer: não está confirmado, não apostou e a janela fechou.
  // Oferecer a aposta a quem não está na lista seria vender bilhete de um jogo
  // que a pessoa não vai jogar.
  if (minha === null && resolvida === null && (!confirmado || !aceita)) return null;

  return (
    <Card>
      <CardHeader>
        <Eyebrow>aposta</Eyebrow>
        {minha !== null && <Badge tom="warn">{minha.valor} zenhas</Badge>}
      </CardHeader>
      <CardBody className="flex flex-col items-start gap-3">
        {resolvida !== null && minha === null ? (
          <DesfechoDaAposta resolvida={resolvida} />
        ) : minha !== null ? (
          <>
            <p className="text-[13px] leading-[1.5] text-fg-2">
              Você apostou <strong className="text-fg">{minha.valor} zenhas</strong> na sua
              vitória. Quem apostou e venceu divide o que os perdedores apostaram — hoje há{" "}
              {pote} zenhas em jogo neste fut.
            </p>
            {aceita ? (
              <form action={cancelarApostaAction.bind(null, matchDayId, minha.id)}>
                <SubmitButton variante="secondary" tamanho="sm">
                  Cancelar aposta
                </SubmitButton>
              </form>
            ) : (
              <p className="text-[12px] text-fg-4">
                Os times já saíram — a aposta travou. O resultado sai um dia depois do fut, quando
                o placar deixa de ser editável.
              </p>
            )}
          </>
        ) : (
          <>
            <p className="text-[13px] leading-[1.5] text-fg-2">
              Aposte na <strong className="text-fg">sua</strong> vitória neste fut. Você aposta
              antes de saber os times, e quem vence divide o que os perdedores apostaram.
              {pote > 0 && ` Já há ${pote} zenhas em jogo.`}
            </p>
            <form action={apostarAction.bind(null, matchDayId)} className="flex items-end gap-2">
              <label className="flex flex-col gap-1 text-[12px] text-fg-3">
                Quanto
                <input
                  type="number"
                  name="valor"
                  required
                  min={apostaMin}
                  max={apostaMax}
                  defaultValue={apostaMin}
                  className="w-24 rounded-md border border-line bg-bg px-2 py-1.5 text-[14px] text-fg"
                />
              </label>
              <SubmitButton tamanho="sm">Apostar</SubmitButton>
            </form>
            <p className="text-[12px] text-fg-4">
              De {apostaMin} a {apostaMax} zenhas. Vale até os times serem definidos — depois
              disso não dá mais para apostar nem cancelar. Se ninguém vencer o fut, ou se todo
              mundo apostar e ninguém perder, a zenha volta.
            </p>
          </>
        )}
      </CardBody>
    </Card>
  );
}

/**
 * O que aconteceu com a aposta, depois da liquidação.
 *
 * Fica no card em vez de virar só uma linha do extrato porque é AQUI que a
 * pessoa vem conferir o fut — e porque a devolução precisa dizer o motivo, que o
 * extrato não tem espaço para contar.
 */
function DesfechoDaAposta({
  resolvida,
}: {
  resolvida: NonNullable<SituacaoDaAposta["resolvida"]>;
}) {
  const { valor, retorno, desfecho, timeNome } = resolvida;

  if (desfecho === "paga") {
    return (
      <p className="text-[13px] leading-[1.5] text-fg-2">
        Você apostou {valor} e recebeu <strong className="text-fg">{retorno} zenhas</strong>
        {timeNome ? ` — venceu com o ${timeNome}.` : "."}
      </p>
    );
  }

  if (desfecho === "perdida") {
    return (
      <p className="text-[13px] leading-[1.5] text-fg-2">
        Você apostou {valor} zenhas e{timeNome ? ` o ${timeNome}` : " seu time"} não venceu o fut.
      </p>
    );
  }

  return (
    <p className="text-[13px] leading-[1.5] text-fg-2">
      Sua aposta de <strong className="text-fg">{valor} zenhas</strong> voltou inteira.
    </p>
  );
}
