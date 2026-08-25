import { Badge } from "@/components/ui/badge";
import { Banner, BannerDaQuery } from "@/components/ui/banner";
import { LinkButton } from "@/components/ui/button";
import { PageHeader, Section } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { HairlineList, HairlineRow } from "@/components/ui/hairline-list";
import { PreviaDoItem } from "@/components/ui/previa-do-item";
import { db } from "@/db";
import type { TipoDeItem } from "@/lib/item-da-loja";
import { ROTULO_DO_TIPO } from "@/lib/loja-admin";
import { lerTodosOsItens, type ItemComVendas } from "@/lib/loja-itens";
import { requirePlatformAdmin } from "@/lib/require-platform-admin";

export const metadata = { title: "Loja" };
export const dynamic = "force-dynamic";

export default async function AdminLojaPage({ searchParams }: PageProps<"/admin/loja">) {
  await requirePlatformAdmin();
  const { erro, ok } = await searchParams;
  const itens = await lerTodosOsItens(db);

  // A lista já vem na ordem da vitrine (`ordenarParaVitrine`), então o Map
  // nasce com as prateleiras na ordem certa: a primeira aparição de cada tipo
  // segue a ordem das prateleiras, e dentro de cada uma o preço.
  const porTipo = new Map<TipoDeItem, ItemComVendas[]>();
  for (const item of itens) {
    const lista = porTipo.get(item.tipo);
    if (lista) lista.push(item);
    else porTipo.set(item.tipo, [item]);
  }
  const prateleiras = [...porTipo.entries()];

  return (
    <div className="flex flex-col gap-7">
      <PageHeader
        titulo="Loja"
        descricao="O catálogo inteiro: o que está à venda, por quanto, e quantas vezes cada coisa foi comprada."
        acao={
          <LinkButton href="/admin/loja/novo" tamanho="sm">
            Novo item
          </LinkButton>
        }
      />

      <BannerDaQuery erro={erro} ok={ok} />

      {/* A garantia central do desenho, e por isso a primeira coisa da tela:
          quem mexe aqui precisa saber o que NÃO acontece. Preço é congelado na
          compra, ledger é append-only, e item vendido não some do perfil de
          ninguém — é essa ausência de reprocessamento que torna esta tela segura
          de usar. */}
      <Banner tom="aviso">
        Mudança vale <strong>dali para frente</strong>. Quem já comprou continua com o item, pelo
        preço que pagou — mesmo depois de ele sair de venda. Só dá para apagar de vez o que ninguém
        comprou.
      </Banner>

      {itens.length === 0 ? (
        <EmptyState
          titulo="Catálogo vazio"
          descricao="Nem o multiplicador está aqui, o que é estranho: ele nasce com a migration. Confira o banco."
          acao={
            <LinkButton href="/admin/loja/novo" variante="primary" tamanho="sm">
              Cadastrar o primeiro item
            </LinkButton>
          }
        />
      ) : (
        prateleiras.map(([tipo, doTipo]) => (
          <Section key={tipo} titulo={ROTULO_DO_TIPO[tipo]}>
            <HairlineList as="ul">
              {doTipo.map((item) => (
                <li key={item.id}>
                  <LinhaDoItem item={item} />
                </li>
              ))}
            </HairlineList>
          </Section>
        ))
      )}
    </div>
  );
}

function LinhaDoItem({ item }: { item: ItemComVendas }) {
  return (
    <HairlineRow className="items-center">
      {/* A prévia, e não só o nome: é a única tela onde o admin confere se a arte
          que ele subiu ficou legível no tamanho em que ela vai aparecer.

          Sem caixa de tamanho fixo em volta: a prévia de um TÍTULO é a cápsula
          com o nome escrito, e ela é bem mais larga que os 32px de um badge —
          numa caixa fixa ela vazava por cima da coluna do nome. Como a lista é
          agrupada POR TIPO, todas as linhas de uma seção têm prévia do mesmo
          formato, e a coluna sai alinhada de qualquer jeito. */}
      <PreviaDoItem item={item} tamanho="sm" />

      <span className="min-w-0 flex-1">
        <span className="block truncate font-display text-[14px] font-bold text-fg">
          {item.nome}
        </span>
        <span className="mt-0.5 block text-[12px] text-fg-4">
          <span data-num>{item.preco.toLocaleString("pt-BR")}</span> zenhas ·{" "}
          {item.vendas === 0 ? (
            "nunca comprado"
          ) : (
            <>
              <span data-num>{item.vendas}</span> {item.vendas === 1 ? "compra" : "compras"}
            </>
          )}
        </span>
      </span>

      {/* O estado escrito, e não só a cor da linha: "fora de venda" é o que o
          admin veio conferir, e um print em preto e branco tem que dizê-lo. */}
      {item.ativo ? (
        <Badge tom="accent" ponto>
          à venda
        </Badge>
      ) : (
        <Badge tom="neutral">fora de venda</Badge>
      )}
      {item.efeito !== null && <Badge tom="warn">efeito</Badge>}

      <LinkButton href={`/admin/loja/${item.id}`} variante="ghost" tamanho="sm">
        Editar
      </LinkButton>
    </HairlineRow>
  );
}
