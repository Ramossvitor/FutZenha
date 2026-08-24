import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { BannerDaQuery } from "@/components/ui/banner";
import { LinkButton, SubmitButton } from "@/components/ui/button";
import { Card, CardBody, Eyebrow, PageHeader, Section } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { HairlineList, HairlineRowLink } from "@/components/ui/hairline-list";
import { IconeZenha } from "@/components/ui/icons";
import { db } from "@/db";
import { formatarReais, rotuloDoStatus } from "@/lib/recarga-formato";
import { listarPacotes, listarPedidosDoJogador, recargaConfigurada } from "@/lib/recarga";
import { RECARGA_EXPIRA_MINUTOS } from "@/lib/regras";
import { requirePlayer } from "@/lib/require-player";
import { criarRecarga } from "./actions";

export const metadata: Metadata = { title: "Comprar zenhas" };
export const dynamic = "force-dynamic";

/**
 * A escolha do pacote é uma ROTA, e não um popover — a mesma decisão da
 * confirmação da loja (/loja/[item]), com um motivo a mais: daqui sai uma
 * cobrança de DINHEIRO DE VERDADE, e a tela inteira é o mínimo antes disso.
 *
 * O caminho: escolher o pacote aqui → a action cria o pedido e a cobrança →
 * a tela do pedido (/zenhas/recarga/[id]) mostra o QR e acompanha o pagamento.
 */
export default async function RecargaPage({ searchParams }: PageProps<"/zenhas/recarga">) {
  const session = await requirePlayer();
  const { erro } = await searchParams;

  const configurada = recargaConfigurada();
  const [pacotes, pedidos] = await Promise.all([
    configurada ? listarPacotes(db) : Promise.resolve([]),
    listarPedidosDoJogador(session.player.id),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        titulo="Comprar zenhas"
        descricao="Pagamento por Pix. As zenhas entram no seu saldo assim que o pagamento cair — normalmente em segundos."
        acao={
          <LinkButton href="/zenhas" variante="ghost" tamanho="sm">
            Minhas zenhas
          </LinkButton>
        }
      />

      <BannerDaQuery erro={erro} />

      {!configurada ? (
        <EmptyState
          titulo="A recarga não está disponível agora"
          descricao="O pagamento por Pix não está configurado neste ambiente. Zenha continua entrando do jeito clássico: jogando."
        />
      ) : pacotes.length === 0 ? (
        <EmptyState
          titulo="Sem pacotes à venda"
          descricao="Nenhum pacote está ativo no momento. Volte mais tarde — ou continue ganhando zenha em campo."
        />
      ) : (
        <Section titulo="Pacotes">
          <div className="grid gap-3 sm:grid-cols-3">
            {pacotes.map((pacote) => (
              <Card key={pacote.id}>
                <CardBody className="flex h-full flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <IconeZenha className="size-5 shrink-0 text-accent-ink" />
                    <Eyebrow>{pacote.nome}</Eyebrow>
                  </div>
                  <p
                    className="font-display text-[28px] leading-none font-black font-stretch-125% tracking-[-.02em] text-fg"
                    data-num
                  >
                    {pacote.zenhas.toLocaleString("pt-BR")}
                  </p>
                  <p className="text-[13px] leading-[1.5] text-fg-3">zenhas no seu saldo</p>
                  <form action={criarRecarga.bind(null, pacote.id)} className="mt-auto">
                    <SubmitButton
                      tamanho="lg"
                      className="w-full"
                      labelPending="Gerando o Pix…"
                      festeja="sobre-accent"
                    >
                      {formatarReais(pacote.precoCentavos)}
                    </SubmitButton>
                  </form>
                </CardBody>
              </Card>
            ))}
          </div>
          <p className="text-[12px] leading-[1.45] text-fg-4">
            O código Pix vale por {RECARGA_EXPIRA_MINUTOS} minutos. Zenha comprada é igual à ganhada
            em campo: gasta na loja e não vira dinheiro de volta — não existe saque nem estorno de
            saldo. Comprou por engano? Fale com o admin em até 7 dias, antes de gastar.
          </p>
        </Section>
      )}

      {pedidos.length > 0 && (
        <Section titulo="Suas recargas">
          <HairlineList as="ul">
            {pedidos.map((pedido) => (
              <li key={pedido.id}>
                <HairlineRowLink href={`/zenhas/recarga/${pedido.id}`} className="items-center">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] leading-[1.35] text-fg" data-num>
                      {pedido.zenhas.toLocaleString("pt-BR")} zenhas ·{" "}
                      {formatarReais(pedido.precoCentavos)}
                    </span>
                    <span className="mt-0.5 block text-[12px] text-fg-4" data-num>
                      {pedido.criadoEm.toLocaleDateString("pt-BR", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "2-digit",
                      })}
                    </span>
                  </span>
                  <Badge tom={rotuloDoStatus(pedido.status).tom}>
                    {rotuloDoStatus(pedido.status).texto}
                  </Badge>
                </HairlineRowLink>
              </li>
            ))}
          </HairlineList>
        </Section>
      )}
    </div>
  );
}
