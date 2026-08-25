import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { LinkButton } from "@/components/ui/button";
import { Card, CardBody, Eyebrow, PageHeader, Section } from "@/components/ui/card";
import { HairlineList, HairlineRow } from "@/components/ui/hairline-list";
import { lerPedidoDoJogador } from "@/lib/recarga";
import { formatarReais, rotuloDoStatus } from "@/lib/recarga-formato";
import { RECARGA_EXPIRA_MINUTOS } from "@/lib/regras";
import { requirePlayer } from "@/lib/require-player";
import { AcompanharRecarga } from "./acompanhar-recarga";
import { CopiarPix } from "./copiar-pix";

export const metadata: Metadata = { title: "Recarga" };
export const dynamic = "force-dynamic";

/** O id da rota, ou `null` se o que veio na URL não é um id plausível. */
function idDaRota(bruto: string): number | null {
  const id = Number(bruto);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * A tela de UM pedido: o QR enquanto espera, a confirmação quando pagar.
 *
 * Revisitável de propósito — aba fechada, link reaberto, o QR gravado no pedido
 * continua aqui até expirar, sem nova ida ao gateway. Só o dono vê: pedido de
 * outra pessoa (ou id que não existe) é 404, a mesma resposta para os dois
 * pela razão de sempre.
 */
export default async function PedidoDeRecargaPage({ params }: PageProps<"/zenhas/recarga/[id]">) {
  const session = await requirePlayer();
  const { id: idBruto } = await params;

  const id = idDaRota(idBruto);
  if (id === null) notFound();
  const pedido = await lerPedidoDoJogador(session.player.id, id);
  if (!pedido) notFound();

  const selo = rotuloDoStatus(pedido.status);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        titulo={`${pedido.zenhas.toLocaleString("pt-BR")} zenhas`}
        selos={
          <Badge tom={selo.tom} ponto={selo.ponto}>
            {selo.texto}
          </Badge>
        }
        descricao={`Pedido de ${formatarReais(pedido.precoCentavos)}, por Pix.`}
        acao={
          <LinkButton href="/zenhas/recarga" variante="ghost" tamanho="sm">
            Voltar
          </LinkButton>
        }
      />

      {pedido.status === "pendente" && (
        <>
          {/* O vigia recarrega a tela quando o Pix cair — e sai da árvore junto
              com este bloco. */}
          <AcompanharRecarga pedidoId={pedido.id} />
          <Section titulo="Pague com o app do seu banco">
            <Card>
              <CardBody className="flex flex-col items-center gap-4">
                {pedido.qrCodeBase64 ? (
                  /* eslint-disable-next-line @next/next/no-img-element -- o QR é
                     um data URI gravado no pedido; next/image não otimiza data
                     URI e só adicionaria um wrapper. */
                  <img
                    src={`data:image/png;base64,${pedido.qrCodeBase64}`}
                    alt="QR code do Pix. Se não conseguir escanear, use o código copia-e-cola abaixo."
                    className="size-56 rounded-ctl border border-line bg-white p-2"
                  />
                ) : null}
                {pedido.qrCode && (
                  <>
                    {/* readOnly, e não disabled: disabled tira do leitor de tela
                        e impede selecionar — que é o fallback de quem não
                        conseguiu copiar pelo botão. */}
                    <textarea
                      readOnly
                      value={pedido.qrCode}
                      rows={3}
                      aria-label="Código Pix copia-e-cola"
                      className="w-full resize-none rounded-ctl border border-line bg-surface-2 px-3 py-2 font-mono text-[11px] leading-[1.4] text-fg-2"
                    />
                    <CopiarPix codigo={pedido.qrCode} />
                  </>
                )}
                <p className="text-[12px] leading-[1.45] text-fg-4">
                  Este código vale até{" "}
                  <strong data-num>
                    {pedido.expiraEm?.toLocaleTimeString("pt-BR", {
                      timeZone: "America/Sao_Paulo",
                      hour: "2-digit",
                      minute: "2-digit",
                    }) ?? "expirar"}
                  </strong>
                  . Assim que o pagamento cair, esta tela avisa sozinha — pode deixar aberta.
                </p>
              </CardBody>
            </Card>
          </Section>
        </>
      )}

      {pedido.status === "pago" && (
        <Section titulo="Tudo certo">
          <Banner tom="ok">
            O Pix caiu e as {pedido.zenhas.toLocaleString("pt-BR")} zenhas já estão no seu saldo.
          </Banner>
          <div className="flex gap-2">
            <LinkButton href="/loja" tamanho="sm">
              Ir à loja
            </LinkButton>
            <LinkButton href="/zenhas" variante="secondary" tamanho="sm">
              Ver o extrato
            </LinkButton>
          </div>
        </Section>
      )}

      {pedido.status === "expirado" && (
        <Section titulo="Este código venceu">
          <Banner tom="aviso">
            O prazo de {RECARGA_EXPIRA_MINUTOS} minutos passou e este Pix não vale mais. Nada foi
            cobrado — se você pagou no último instante, o crédito entra sozinho em alguns minutos.
          </Banner>
          <LinkButton href="/zenhas/recarga" tamanho="sm" className="self-start">
            Gerar um novo
          </LinkButton>
        </Section>
      )}

      {pedido.status === "cancelado" && (
        <Section titulo="O Pix não foi gerado">
          <Banner tom="aviso">
            O sistema de pagamento não respondeu quando este pedido foi criado. Nada foi cobrado —
            tente de novo.
          </Banner>
          <LinkButton href="/zenhas/recarga" tamanho="sm" className="self-start">
            Tentar de novo
          </LinkButton>
        </Section>
      )}

      {pedido.status === "estornado" && (
        <Banner tom="aviso">
          O valor deste pedido foi devolvido pelo sistema de pagamento. O admin da plataforma já foi
          avisado e vai falar com você sobre o saldo.
        </Banner>
      )}

      <Section titulo="O pedido">
        <Card>
          <CardBody>
            <HairlineList>
              <HairlineRow>
                <span className="flex-1">Zenhas</span>
                <span className="font-display font-extrabold text-fg" data-num>
                  {pedido.zenhas.toLocaleString("pt-BR")}
                </span>
              </HairlineRow>
              <HairlineRow>
                <span className="flex-1">Valor</span>
                <span className="font-display font-extrabold text-fg" data-num>
                  {formatarReais(pedido.precoCentavos)}
                </span>
              </HairlineRow>
              <HairlineRow>
                <span className="flex-1 text-fg-2">Criado em</span>
                {/* Só a data, como no extrato: `criado_em` é timestamp sem fuso
                    e o driver o devolve no fuso do processo — imprimir hora
                    daqui inventaria precisão que a coluna não tem. */}
                <span className="text-fg-2" data-num>
                  {pedido.criadoEm.toLocaleDateString("pt-BR", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "2-digit",
                  })}
                </span>
              </HairlineRow>
              <HairlineRow>
                <span className="flex-1 text-fg-2">
                  <Eyebrow>pedido</Eyebrow>
                </span>
                <span className="text-fg-2" data-num>
                  #{pedido.id}
                </span>
              </HairlineRow>
            </HairlineList>
          </CardBody>
        </Card>
      </Section>
    </div>
  );
}
