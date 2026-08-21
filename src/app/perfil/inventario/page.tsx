import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { BannerDaQuery } from "@/components/ui/banner";
import { LinkButton, SubmitButton } from "@/components/ui/button";
import { PageHeader, Section } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { HairlineList, HairlineRow } from "@/components/ui/hairline-list";
import { Selo } from "@/components/ui/selo";
import { formatDateShort } from "@/lib/format";
import { getInventario, type ItemDoInventario } from "@/lib/loja";
import type { SlotDeExibicao } from "@/lib/loja-catalogo";
import { requirePlayer } from "@/lib/require-player";
import { desequiparSlot, equiparItem } from "./actions";

export const metadata: Metadata = { title: "Inventário" };
export const dynamic = "force-dynamic";

/**
 * As prateleiras do inventário, na ordem em que elas aparecem no perfil de cima
 * para baixo. `Record` fechado: slot novo em `SlotDeExibicao` sem rótulo aqui
 * não compila, e sem isso o item comprado sumiria da tela sem ninguém notar —
 * o defeito mais caro possível num produto que vende cosmético.
 */
const PRATELEIRAS: Readonly<Record<SlotDeExibicao, { titulo: string; vazio: string }>> = {
  badge: { titulo: "Badges", vazio: "Nenhum badge ainda." },
  moldura: { titulo: "Molduras", vazio: "Nenhuma moldura ainda." },
  cor_do_nome: { titulo: "Cores do nome", vazio: "Seu nome está na cor padrão." },
  titulo: { titulo: "Títulos", vazio: "Nenhum título ainda." },
};

const ORDEM: SlotDeExibicao[] = ["badge", "moldura", "cor_do_nome", "titulo"];

export default async function InventarioPage({ searchParams }: PageProps<"/perfil/inventario">) {
  const session = await requirePlayer();
  const { erro, ok } = await searchParams;
  const itens = await getInventario(session.player.id);

  const consumiveis = itens.filter((i) => i.item.slot === null);
  const cosmeticos = itens.filter((i) => i.item.slot !== null);

  return (
    <div className="flex flex-col gap-7">
      <PageHeader
        titulo="Inventário"
        descricao="O que você comprou. Um item por lugar no perfil — equipar troca quem estava lá."
        acao={
          <div className="flex gap-2">
            {/* O perfil público é o resultado de tudo que se equipa aqui — e é
                a única tela onde dá para conferir se ficou como se queria. */}
            <LinkButton href={`/jogador/${session.player.id}`} variante="ghost" tamanho="sm">
              Ver meu perfil
            </LinkButton>
            <LinkButton href="/loja" variante="secondary" tamanho="sm">
              Ir à loja
            </LinkButton>
          </div>
        }
      />

      <BannerDaQuery erro={erro} ok={ok} />

      {itens.length === 0 ? (
        <EmptyState
          titulo="Ainda vazio"
          descricao="Zenha entra sozinha a cada fut apurado. Quando der, a loja está logo ali — e nada lá te faz jogar melhor."
          acao={
            <LinkButton href="/loja" variante="primary" tamanho="sm">
              Ver a loja
            </LinkButton>
          }
        />
      ) : (
        <>
          <Section titulo="Multiplicadores">
            <p className="text-[12.5px] leading-[1.5] text-fg-4">
              {/* Nenhum botão de armar aqui, e isso é decisão: o gesto é sobre
                  UM fut e o prazo é o daquele fut, então ele mora na página do
                  fut. Uma segunda lista de futs aqui teria regras próprias de o
                  que aparece — e divergiria da primeira no dia em que uma das
                  duas mudasse. */}
              Multiplicador se arma na página do fut, e vale até o horário de início dele. Aqui você
              só vê onde cada um está.
            </p>
            <HairlineList
              as="ul"
              vazio={
                <EmptyState
                  titulo="Nenhum multiplicador guardado"
                  descricao="É o único item recomprável da loja — e o único que mexe na sua nota, nos dois sentidos."
                />
              }
            >
              {consumiveis.map((guardado) => (
                <li key={guardado.inventarioId}>
                  <LinhaDeMultiplicador guardado={guardado} />
                </li>
              ))}
            </HairlineList>
          </Section>

          {ORDEM.map((slot) => (
            <Section key={slot} titulo={PRATELEIRAS[slot].titulo}>
              <HairlineList
                as="ul"
                vazio={
                  <p className="text-[13px] text-fg-4">{PRATELEIRAS[slot].vazio}</p>
                }
              >
                {cosmeticos
                  .filter((c) => c.item.slot === slot)
                  .map((cosmetico) => (
                    <li key={cosmetico.inventarioId}>
                      <LinhaDeCosmetico cosmetico={cosmetico} slot={slot} />
                    </li>
                  ))}
              </HairlineList>
            </Section>
          ))}
        </>
      )}
    </div>
  );
}

/**
 * Um multiplicador guardado: a força congelada nele e onde ele está.
 *
 * O fut armado vira LINK, e não só texto: quem quer desarmar precisa chegar
 * naquela página, que é onde o botão mora.
 */
function LinhaDeMultiplicador({ guardado }: { guardado: ItemDoInventario }) {
  return (
    <HairlineRow className="items-start">
      <span className="min-w-0 flex-1">
        <Selo item={guardado.item} />
        <span className="mt-1 block text-[12.5px] text-fg-4">
          {guardado.fatorPercent !== null && (
            <>
              <span data-num>
                {(guardado.fatorPercent / 100).toLocaleString("pt-BR", {
                  minimumFractionDigits: 1,
                })}
                ×
              </span>{" "}
              ·{" "}
            </>
          )}
          comprado em <span data-num>{formatDataDeCompra(guardado.adquiridoEm)}</span> por{" "}
          <span data-num>{guardado.precoPago.toLocaleString("pt-BR")}</span>
        </span>
      </span>

      {/* Três estados, e não dois. O consumido continua na lista de propósito:
          a linha dele é o registro de que a aposta aconteceu, e o fato que o
          replay da nota lê aponta para ela — apagar do inventário evaporaria o
          insumo do cálculo. Mostrá-lo como "livre" seria pior ainda: o botão de
          armar apareceria para um item que a action recusa. */}
      {guardado.consumidoEm ? (
        <Badge tom="neutral">usado</Badge>
      ) : guardado.armadoNo ? (
        <span className="flex shrink-0 flex-col items-end gap-1">
          <Badge tom="warn">armado</Badge>
          <LinkButton
            href={`/fut/${guardado.armadoNo.id}`}
            variante="ghost"
            tamanho="sm"
            className="-mr-3"
          >
            {formatDateShort(guardado.armadoNo.data)} · {guardado.armadoNo.local}
          </LinkButton>
        </span>
      ) : (
        <Badge tom="dashed">livre</Badge>
      )}
    </HairlineRow>
  );
}

/** Um cosmético: equipar troca quem estava no slot; tirar deixa o slot vazio. */
function LinhaDeCosmetico({
  cosmetico,
  slot,
}: {
  cosmetico: ItemDoInventario;
  slot: SlotDeExibicao;
}) {
  const equipado = cosmetico.equipadoEm !== null;
  return (
    <HairlineRow className="items-center">
      <span className="min-w-0 flex-1">
        <Selo item={cosmetico.item} />
        <span className="mt-1 block text-[12px] text-fg-4">
          comprado em <span data-num>{formatDataDeCompra(cosmetico.adquiridoEm)}</span> por{" "}
          <span data-num>{cosmetico.precoPago.toLocaleString("pt-BR")}</span>
        </span>
      </span>

      {equipado ? (
        <>
          <Badge tom="accent" ponto>
            no perfil
          </Badge>
          <form action={desequiparSlot.bind(null, slot)}>
            <SubmitButton variante="ghost" tamanho="sm" labelPending="Tirando…">
              Tirar
            </SubmitButton>
          </form>
        </>
      ) : (
        <form action={equiparItem.bind(null, cosmetico.inventarioId)}>
          <SubmitButton variante="secondary" tamanho="sm" labelPending="Equipando…">
            Equipar
          </SubmitButton>
        </form>
      )}
    </HairlineRow>
  );
}

// `adquirido_em` é um timestamp de verdade (o instante da compra), então ele não
// passa pelo formatDate do fut, que espera a coluna `date` em "YYYY-MM-DD".
function formatDataDeCompra(quando: Date): string {
  return quando.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });
}
