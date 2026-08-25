import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Banner, BannerDaQuery } from "@/components/ui/banner";
import { LinkButton, SubmitButton } from "@/components/ui/button";
import { Card, CardBody, PageHeader, Section } from "@/components/ui/card";
import { HairlineList, HairlineRow } from "@/components/ui/hairline-list";
import { PreviaDoItem } from "@/components/ui/previa-do-item";
import { db } from "@/db";
import { ehMultiplicador } from "@/lib/item-da-loja";
import { ROTULO_DO_TIPO } from "@/lib/loja-admin";
import { lerItem } from "@/lib/loja-itens";
import { requirePlayer } from "@/lib/require-player";
import { comprarItem } from "../actions";
import { carregarItemDaLoja } from "../dados";

export const dynamic = "force-dynamic";

/**
 * A confirmação da compra é uma ROTA, e não um popover em cima da vitrine.
 *
 * É a regra da casa e ela tem dono: o seletor de grupo é o único popover do app
 * (está escrito no globals.css). Aqui a rota ainda paga por si: gastar zenha é
 * irreversível — não existe estorno no ledger —, e uma tela inteira com o preço,
 * o saldo e o que sobra é o mínimo antes de um botão que não desfaz.
 */

/** O id da rota, ou `null` se o que veio na URL não é um id plausível. */
function idDaRota(bruto: string): number | null {
  const id = Number(bruto);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function generateMetadata({
  params,
}: PageProps<"/loja/[item]">): Promise<Metadata> {
  const { item } = await params;
  const id = idDaRota(item);
  const daLoja = id === null ? undefined : await lerItem(db, id);
  return { title: daLoja?.nome ?? "Loja" };
}

export default async function ItemDaLojaPage({ params, searchParams }: PageProps<"/loja/[item]">) {
  const session = await requirePlayer();
  const { item: idBruto } = await params;
  const { erro } = await searchParams;

  // Id que não existe é rota que não existe. Item FORA DE VENDA é outra coisa —
  // ele continua sendo um item de verdade, e a tela abaixo explica que ele saiu
  // de venda em vez de dar 404 na cara de quem clicou num link antigo.
  const id = idDaRota(idBruto);
  if (id === null) notFound();
  const item = await lerItem(db, id);
  if (!item) notFound();

  const { saldo, multiplicadoresNoMes, fatorDoMultiplicador, daVitrine } =
    await carregarItemDaLoja(session.player.id, id);

  const ehOMultiplicador = ehMultiplicador(item);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        titulo={item.nome}
        selos={<Badge tom="outline">{ROTULO_DO_TIPO[item.tipo]}</Badge>}
        descricao={item.descricao}
        acao={
          <LinkButton href="/loja" variante="ghost" tamanho="sm">
            Voltar à loja
          </LinkButton>
        }
      />

      <BannerDaQuery erro={erro} />

      {/* A arte em tamanho grande, antes da conta: é o que a pessoa está
          comprando, e a última chance de ver de perto o que vai ficar pendurado
          no perfil dela. */}
      <Card>
        <CardBody className="flex items-center justify-center py-7">
          <PreviaDoItem item={item} tamanho="lg" />
        </CardBody>
      </Card>

      {daVitrine === undefined ? (
        <Banner tom="aviso">
          Este item saiu de venda. Quem comprou continua com ele — e continua exibindo —, mas não dá
          mais para adquirir.
        </Banner>
      ) : daVitrine.possui ? (
        <Section titulo="Você já tem">
          <Banner tom="ok">
            Este item já está no seu inventário. Cosmético não se compra duas vezes: é lá que você
            escolhe onde ele aparece.
          </Banner>
          <LinkButton href="/perfil/inventario" variante="secondary" tamanho="sm" className="self-start">
            Ir ao inventário
          </LinkButton>
        </Section>
      ) : (
        <Section titulo="A conta">
          <Card>
            <CardBody className="flex flex-col gap-4">
              <HairlineList>
                <HairlineRow>
                  <span className="flex-1">Preço</span>
                  <span className="font-display font-extrabold text-fg" data-num>
                    {daVitrine.preco.toLocaleString("pt-BR")}
                  </span>
                </HairlineRow>
                <HairlineRow>
                  <span className="flex-1">Seu saldo</span>
                  <span className="font-display font-extrabold text-fg" data-num>
                    {saldo.toLocaleString("pt-BR")}
                  </span>
                </HairlineRow>
                <HairlineRow>
                  <span className="flex-1 text-fg-2">Sobra depois</span>
                  {/* O sinal e a palavra, nunca a cor sozinha: a linha que
                      importa aqui é justamente a negativa, e ela precisa se
                      explicar num print em preto e branco. */}
                  {saldo >= daVitrine.preco ? (
                    <span className="font-display font-extrabold text-fg" data-num>
                      {(saldo - daVitrine.preco).toLocaleString("pt-BR")}
                    </span>
                  ) : (
                    <Badge tom="danger">
                      faltam {(daVitrine.preco - saldo).toLocaleString("pt-BR")}
                    </Badge>
                  )}
                </HairlineRow>
              </HairlineList>

              {ehOMultiplicador && (
                <div className="flex flex-col gap-2 rounded-ctl border border-warn-line bg-warn-tint px-3.5 py-3">
                  <p className="text-[13px] leading-[1.5] text-warn-ink">
                    <strong>O preço sobe a cada compra dentro do mesmo mês.</strong>{" "}
                    {multiplicadoresNoMes === 0
                      ? "Este é o primeiro do mês, então é o preço de tabela — o próximo custa mais."
                      : `Você já comprou ${multiplicadoresNoMes} neste mês, então este já está mais caro que o de tabela.`}{" "}
                    No dia 1º a contagem reinicia.
                  </p>
                  <p className="text-[13px] leading-[1.5] text-warn-ink">
                    Ele amplia o movimento da sua nota em{" "}
                    <strong data-num>
                      {(fatorDoMultiplicador / 100).toLocaleString("pt-BR", {
                        minimumFractionDigits: 1,
                      })}
                      ×
                    </strong>{" "}
                    <strong>nos dois sentidos</strong> — é aposta, não presente. A força fica
                    congelada nesta compra, mesmo que ela mude depois.
                  </p>
                </div>
              )}

              <form action={comprarItem.bind(null, item.id)}>
                <SubmitButton
                  tamanho="lg"
                  className="w-full"
                  labelPending="Comprando…"
                  disabled={saldo < daVitrine.preco}
                  // O botão sai da árvore no sucesso (a action redireciona para
                  // o inventário), então a desmontagem já é a prova de que deu
                  // certo — não precisa de `festejaQuando`.
                  festeja="sobre-accent"
                >
                  {saldo < daVitrine.preco
                    ? `${daVitrine.preco.toLocaleString("pt-BR")} zenhas`
                    : `Comprar por ${daVitrine.preco.toLocaleString("pt-BR")}`}
                </SubmitButton>
              </form>

              <p className="text-[12px] leading-[1.45] text-fg-4">
                {ehOMultiplicador
                  ? "Comprado, ele vai para o inventário. Só vale depois de armado num fut — e só até o horário de início dele."
                  : "Comprado, ele já entra no seu perfil — na vitrine, se for badge, ou no lugar dele, se estiver vago. Trocar é no inventário. Zenha gasta não volta: não existe estorno."}
              </p>
            </CardBody>
          </Card>
        </Section>
      )}
    </div>
  );
}
