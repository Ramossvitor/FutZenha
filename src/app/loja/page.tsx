import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { BannerDaQuery } from "@/components/ui/banner";
import { LinkButton } from "@/components/ui/button";
import { Card, CardLink, Eyebrow, PageHeader, Section } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { IconeZenha } from "@/components/ui/icons";
import { PreviaDoItem } from "@/components/ui/previa-do-item";
import type { ItemDaLoja } from "@/lib/item-da-loja";
import { requirePlayer } from "@/lib/require-player";
import { carregarLoja, type Prateleira } from "./dados";

export const metadata: Metadata = { title: "Loja" };
export const dynamic = "force-dynamic";

const LOCAIS = {
  // Na vitrine o slug só chega pelo id forjado ou pelo item recém-retirado de
  // venda — o texto global fala do link direto, que é o caso da tela de
  // confirmação.
  "item-indisponivel": "Esse item não está mais à venda.",
};

export default async function LojaPage({ searchParams }: PageProps<"/loja">) {
  const session = await requirePlayer();
  const { erro, ok } = await searchParams;
  const { saldo, multiplicadoresNoMes, prateleiras } = await carregarLoja(session.player.id);

  return (
    <div className="flex flex-col gap-7">
      <PageHeader
        titulo="Loja da zenha"
        descricao="Nada aqui te faz jogar melhor — com uma exceção, e ela é uma aposta. O resto é vaidade paga com o que você ganhou em campo."
        acao={
          <LinkButton href="/perfil/inventario" variante="secondary" tamanho="sm">
            Meu inventário
          </LinkButton>
        }
      />

      <BannerDaQuery erro={erro} ok={ok} locais={LOCAIS} />

      {/* O saldo no topo da loja mesmo com o chip no cabeçalho: o chip é do app
          inteiro e mede 14px; aqui ele é a informação que decide cada card da
          página abaixo. */}
      <Card className="flex items-center gap-4 p-4">
        <IconeZenha className="size-7 shrink-0 text-accent-ink" />
        <div className="min-w-0 flex-1">
          <Eyebrow>seu saldo</Eyebrow>
          <p
            className="font-display text-[28px] leading-none font-black font-stretch-125% text-fg"
            data-num
          >
            {saldo.toLocaleString("pt-BR")}
          </p>
        </div>
        <LinkButton href="/zenhas" variante="ghost" tamanho="sm">
          Ver extrato
        </LinkButton>
      </Card>

      {prateleiras.length === 0 ? (
        // Loja vazia é estado de verdade, e não hipótese: o catálogo nasce só com
        // o multiplicador, e tudo o mais depende de o admin cadastrar. Sem isto a
        // página seria um saldo solto no branco.
        <EmptyState
          titulo="Nada à venda ainda"
          descricao="A loja está sendo montada. Sua zenha continua entrando a cada fut apurado — e ela não vence."
          acao={
            <LinkButton href="/zenhas" variante="secondary" tamanho="sm">
              Ver seu extrato
            </LinkButton>
          }
        />
      ) : (
        prateleiras.map((prateleira) => (
          <SecaoDaPrateleira
            key={prateleira.chave}
            prateleira={prateleira}
            saldo={saldo}
            multiplicadoresNoMes={multiplicadoresNoMes}
          />
        ))
      )}
    </div>
  );
}

function SecaoDaPrateleira({
  prateleira,
  saldo,
  multiplicadoresNoMes,
}: {
  prateleira: Prateleira;
  saldo: number;
  multiplicadoresNoMes: number;
}) {
  return (
    <Section titulo={prateleira.titulo}>
      <p className="text-[12.5px] leading-[1.5] text-fg-4">{prateleira.descricao}</p>

      {/* A escada dita no lugar em que ela cobra. Só aparece depois da primeira
          compra do mês, porque antes dela o preço da vitrine É o preço de
          tabela e o aviso seria letra miúda sobre coisa nenhuma. */}
      {prateleira.chave === "consumivel" && multiplicadoresNoMes > 0 && (
        <p className="text-[12.5px] leading-[1.5] text-warn-ink">
          Você já comprou {multiplicadoresNoMes}{" "}
          {multiplicadoresNoMes === 1 ? "multiplicador" : "multiplicadores"} neste mês, então o
          preço abaixo já subiu. Ele volta ao normal no dia 1º.
        </p>
      )}

      {/* Showroom: a grade é de quadrados e a ARTE ocupa o card. Duas colunas já
          no celular — com uma, a página vira um rolo e não dá para comparar dois
          itens sem rolar. */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {prateleira.itens.map(({ item, preco, possui }) => (
          <CardDoItem key={item.id} item={item} preco={preco} possui={possui} saldo={saldo} />
        ))}
      </div>

      {prateleira.chave === "consumivel" && (
        <p className="text-[12px] leading-[1.45] text-fg-4">
          O preço sobe a cada compra dentro do mesmo mês — este item é para ser um evento, não uma
          rotina.
        </p>
      )}
    </Section>
  );
}

/**
 * Um item no showroom.
 *
 * O card inteiro é o alvo de toque quando dá para comprar, e vira `Card` inerte
 * quando o item já é seu — um link para uma tela que só diz "você já tem" é
 * caminho que não leva a lugar nenhum. Sem saldo o card CONTINUA clicável de
 * propósito: a tela de confirmação é onde está escrito quanto falta, e trancar a
 * porta esconderia justamente essa conta.
 *
 * Nada de `flex` na raiz: `Card` e `CardLink` já trazem `display` na string
 * deles (`block` no link), e o `cx` do projeto não faz merge — quem vencesse a
 * disputa seria a ordem no CSS gerado, que é aposta. Os dois filhos são blocos e
 * empilham sozinhos; o flex mora dentro de cada um.
 */
function CardDoItem({
  item,
  preco,
  possui,
  saldo,
}: {
  item: ItemDaLoja;
  preco: number;
  possui: boolean;
  saldo: number;
}) {
  const miolo = (
    <>
      {/* O quadrado é o que faz a grade ler como prateleira mesmo com itens de
          desenhos muito diferentes: uma imagem, um anel, duas letras. */}
      <div className="flex aspect-square items-center justify-center bg-surface-2 p-3">
        <PreviaDoItem item={item} tamanho="lg" />
      </div>
      {/* Altura mínima igual nos dois estados (preço ou "seu"), senão as linhas
          da grade dançariam conforme o que cada jogador já comprou. */}
      <div className="flex min-h-[3.25rem] flex-col justify-center gap-1 px-3 py-2.5">
        <p className="truncate font-display text-[13px] leading-[1.2] font-bold text-fg">
          {item.nome}
        </p>
        {possui ? (
          <Badge tom="accent" ponto className="self-start">
            seu
          </Badge>
        ) : (
          // O preço apagado quando o saldo não cobre — apagado, e não escondido:
          // o número é a única coisa acionável ali, é ele que diz quanto falta
          // jogar. O PESO do texto muda junto com a cor, pelo mesmo motivo do
          // extrato: um print em preto e branco tem que contar a mesma história.
          <p
            className={
              saldo >= preco
                ? "font-display text-[13px] leading-none font-extrabold text-fg"
                : "font-display text-[13px] leading-none font-medium text-fg-4"
            }
            data-num
          >
            {preco.toLocaleString("pt-BR")}
          </p>
        )}
      </div>
    </>
  );

  return possui ? (
    // `overflow-hidden` para o fundo do quadrado ser cortado pelo raio do card.
    <Card className="overflow-hidden">{miolo}</Card>
  ) : (
    <CardLink
      href={`/loja/${item.id}`}
      className="overflow-hidden"
      aria-label={`${item.nome}, ${preco} zenhas`}
    >
      {miolo}
    </CardLink>
  );
}
