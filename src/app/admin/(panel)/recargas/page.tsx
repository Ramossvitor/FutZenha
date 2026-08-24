import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Banner, BannerDaQuery } from "@/components/ui/banner";
import { SubmitButton } from "@/components/ui/button";
import { Card, CardBody, Eyebrow, PageHeader, Section } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input } from "@/components/ui/field";
import { HairlineList, HairlineRow } from "@/components/ui/hairline-list";
import { db } from "@/db";
import { recargaConfigurada } from "@/lib/recarga";
import { listarPedidosRecentes, listarTodosPacotes, resumoDoMes } from "@/lib/recarga-admin";
import { formatarReais, rotuloDoStatus } from "@/lib/recarga-formato";
import { requirePlatformAdmin } from "@/lib/require-platform-admin";
import { alternarPacoteAction, criarPacoteAction, salvarPacoteAction } from "./actions";

export const metadata: Metadata = { title: "Recargas" };
export const dynamic = "force-dynamic";

/**
 * O painel da recarga: o caixa do mês, os pedidos e o cardápio de pacotes.
 *
 * Estorno NÃO tem botão aqui de propósito: quem estorna é o dono da conta no
 * painel do Mercado Pago (o dinheiro mora lá), e o sistema fica sabendo pelo
 * webhook — o pedido vira `estornado` e os admins são avisados. Um botão de
 * estorno aqui prometeria mexer num dinheiro que o app não segura.
 */
export default async function RecargasAdminPage({ searchParams }: PageProps<"/admin/recargas">) {
  await requirePlatformAdmin();
  const { erro, ok } = await searchParams;

  const [resumo, pedidos, pacotes] = await Promise.all([
    resumoDoMes(db),
    listarPedidosRecentes(db),
    listarTodosPacotes(db),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        titulo="Recargas"
        descricao="A compra de zenhas por Pix: o caixa do mês, os pedidos e os pacotes à venda."
      />

      <BannerDaQuery erro={erro} ok={ok} />

      {!recargaConfigurada() && (
        <Banner tom="aviso">
          O gateway não está configurado neste ambiente (MP_ACCESS_TOKEN ausente) — a tela de
          recarga está escondida dos jogadores e nenhuma cobrança sai daqui.
        </Banner>
      )}

      <Section titulo="O mês">
        <div className="grid gap-3 sm:grid-cols-4">
          {[
            { rotulo: "arrecadado", valor: formatarReais(resumo.arrecadadoCentavos) },
            { rotulo: "recargas pagas", valor: String(resumo.pagos) },
            { rotulo: "aguardando Pix", valor: String(resumo.pendentes) },
            { rotulo: "estornadas", valor: String(resumo.estornados) },
          ].map((caixa) => (
            <Card key={caixa.rotulo}>
              <CardBody className="flex flex-col gap-1">
                <Eyebrow>{caixa.rotulo}</Eyebrow>
                <p className="font-display text-[24px] leading-none font-black text-fg" data-num>
                  {caixa.valor}
                </p>
              </CardBody>
            </Card>
          ))}
        </div>
      </Section>

      <Section titulo="Pedidos recentes">
        {pedidos.length === 0 ? (
          <EmptyState
            titulo="Nenhum pedido ainda"
            descricao="Quando alguém comprar zenhas, o pedido aparece aqui."
          />
        ) : (
          <HairlineList as="ul">
            {pedidos.map((pedido) => {
              const selo = rotuloDoStatus(pedido.status);
              return (
                <li key={pedido.id}>
                  <HairlineRow className="items-center">
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px] leading-[1.35] text-fg">
                        <Link href={`/jogador/${pedido.jogador.slug}`} className="hover:underline">
                          {pedido.jogador.nome}
                        </Link>{" "}
                        <span className="text-fg-3" data-num>
                          · {pedido.zenhas.toLocaleString("pt-BR")} zenhas ·{" "}
                          {formatarReais(pedido.precoCentavos)}
                        </span>
                      </span>
                      <span className="mt-0.5 block text-[12px] text-fg-4" data-num>
                        pedido #{pedido.id} ·{" "}
                        {pedido.criadoEm.toLocaleDateString("pt-BR", {
                          day: "2-digit",
                          month: "2-digit",
                          year: "2-digit",
                        })}
                      </span>
                    </span>
                    <Badge tom={selo.tom} ponto={selo.ponto}>
                      {selo.texto}
                    </Badge>
                  </HairlineRow>
                </li>
              );
            })}
          </HairlineList>
        )}
      </Section>

      <Section titulo="Pacotes">
        <p className="text-[13px] leading-[1.5] text-fg-3">
          Mexer num pacote vale daqui para frente — o pedido já criado está congelado com o preço e
          as zenhas que prometeu. Pacote não se apaga: tire de venda e ele some da tela de recarga.
        </p>
        {pacotes.map((pacote) => (
          <Card key={pacote.id}>
            <CardBody>
              <form
                action={salvarPacoteAction.bind(null, pacote.id)}
                className="flex flex-col gap-3"
              >
                <div className="grid gap-3 sm:grid-cols-4">
                  <Field htmlFor={`nome-${pacote.id}`} label="Nome" obrigatorio>
                    <Input id={`nome-${pacote.id}`} name="nome" defaultValue={pacote.nome} required />
                  </Field>
                  <Field htmlFor={`preco-${pacote.id}`} label="Preço (R$)" obrigatorio>
                    <Input
                      id={`preco-${pacote.id}`}
                      name="preco"
                      inputMode="decimal"
                      defaultValue={(pacote.precoCentavos / 100).toFixed(2).replace(".", ",")}
                      required
                    />
                  </Field>
                  <Field htmlFor={`zenhas-${pacote.id}`} label="Zenhas" obrigatorio>
                    <Input
                      id={`zenhas-${pacote.id}`}
                      name="zenhas"
                      type="number"
                      min={1}
                      defaultValue={pacote.zenhas}
                      required
                    />
                  </Field>
                  <Field
                    htmlFor={`ordem-${pacote.id}`}
                    label="Ordem"
                    ajuda="Menor aparece primeiro."
                  >
                    <Input
                      id={`ordem-${pacote.id}`}
                      name="ordem"
                      type="number"
                      min={0}
                      defaultValue={pacote.ordem}
                    />
                  </Field>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <SubmitButton tamanho="sm" variante="secondary" labelPending="Salvando…">
                    Salvar
                  </SubmitButton>
                  {/* O toggle é outro form, aninhado seria HTML inválido — o
                      formAction no botão resolve com um form só. */}
                  <SubmitButton
                    tamanho="sm"
                    variante="ghost"
                    formAction={alternarPacoteAction.bind(null, pacote.id, !pacote.ativo)}
                    labelPending="…"
                  >
                    {pacote.ativo ? "Tirar de venda" : "Pôr à venda"}
                  </SubmitButton>
                  {!pacote.ativo && <Badge tom="outline">fora de venda</Badge>}
                </div>
              </form>
            </CardBody>
          </Card>
        ))}
      </Section>

      <Section titulo="Novo pacote">
        <Card>
          <CardBody>
            <form action={criarPacoteAction} className="flex flex-col gap-3">
              <div className="grid gap-3 sm:grid-cols-4">
                <Field htmlFor="novo-nome" label="Nome" obrigatorio>
                  <Input id="novo-nome" name="nome" placeholder="Baú" required />
                </Field>
                <Field htmlFor="novo-preco" label="Preço (R$)" obrigatorio>
                  <Input id="novo-preco" name="preco" inputMode="decimal" placeholder="10,00" required />
                </Field>
                <Field htmlFor="novo-zenhas" label="Zenhas" obrigatorio>
                  <Input id="novo-zenhas" name="zenhas" type="number" min={1} placeholder="250" required />
                </Field>
                <Field htmlFor="novo-ordem" label="Ordem">
                  <Input id="novo-ordem" name="ordem" type="number" min={0} defaultValue={0} />
                </Field>
              </div>
              <SubmitButton tamanho="sm" className="self-start" labelPending="Criando…">
                Criar pacote
              </SubmitButton>
            </form>
          </CardBody>
        </Card>
      </Section>
    </div>
  );
}
