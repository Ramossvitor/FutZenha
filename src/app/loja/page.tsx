import type { Metadata } from "next";
import { BannerDaQuery } from "@/components/ui/banner";
import { Button, LinkButton } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, Eyebrow, PageHeader, Section } from "@/components/ui/card";
import { IconeZenha } from "@/components/ui/icons";
import { Selo } from "@/components/ui/selo";
import { requirePlayer } from "@/lib/require-player";
import { carregarLoja, type Prateleira } from "./dados";

export const metadata: Metadata = { title: "Loja" };
export const dynamic = "force-dynamic";

const LOCAIS = {
  // Na vitrine o slug só chega pelo id forjado ou pelo item recém-aposentado —
  // o texto global fala do link direto, que é o caso da tela de confirmação.
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
          inteiro e mede 14px; aqui ele é a informação que decide cada botão da
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

      {prateleiras.map((prateleira) => (
        <SecaoDaPrateleira
          key={prateleira.chave}
          prateleira={prateleira}
          saldo={saldo}
          multiplicadoresNoMes={multiplicadoresNoMes}
        />
      ))}
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

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {prateleira.itens.map(({ item, preco, possui }) => (
          <Card key={item.id} className="flex flex-col">
            <CardBody className="flex flex-1 flex-col gap-2.5">
              <Selo item={item} className="self-start" />
              <p className="flex-1 text-[13px] leading-[1.5] text-fg-2">{item.descricao}</p>

              {possui ? (
                <Badge tom="accent" ponto className="self-start">
                  no inventário
                </Badge>
              ) : saldo >= preco ? (
                <LinkButton
                  href={`/loja/${item.id}`}
                  tamanho="sm"
                  className="w-full"
                  aria-label={`Comprar ${item.nome} por ${preco} zenhas`}
                >
                  Comprar · {preco.toLocaleString("pt-BR")}
                </LinkButton>
              ) : (
                // Desabilitado mostrando o PREÇO, e não um "sem saldo": o
                // número é a única coisa acionável ali — é ele que diz quanto
                // falta jogar. O rótulo repetido no aria-label porque o
                // `disabled` já tira o elemento da ordem de foco, e sem ele o
                // leitor de tela ouviria só um número solto.
                <Button
                  disabled
                  variante="secondary"
                  tamanho="sm"
                  className="w-full"
                  aria-label={`${item.nome} custa ${preco} zenhas — seu saldo não cobre`}
                >
                  {preco.toLocaleString("pt-BR")} zenhas
                </Button>
              )}
            </CardBody>
          </Card>
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
