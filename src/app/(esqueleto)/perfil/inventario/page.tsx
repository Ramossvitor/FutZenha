import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { BannerDaQuery } from "@/components/ui/banner";
import { LinkButton, SubmitButton } from "@/components/ui/button";
import { PageHeader, Section } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { HairlineList, HairlineRow } from "@/components/ui/hairline-list";
import { ImagemDoItem } from "@/components/ui/imagem-do-item";
import { PreviaDoItem } from "@/components/ui/previa-do-item";
import { formatDateShort } from "@/lib/format";
import { VAGAS_NA_VITRINE, type SlotDeExibicao } from "@/lib/item-da-loja";
import { getInventario, type ItemDoInventario } from "@/lib/loja";
import { requirePlayer } from "@/lib/require-player";
import {
  desequiparSlot,
  destacarBadge,
  equiparItem,
  porBadgeNaVitrine,
  tirarBadgeDaVitrine,
} from "./actions";

export const metadata: Metadata = { title: "Inventário" };
export const dynamic = "force-dynamic";

/**
 * As prateleiras de slot único, na ordem em que elas aparecem no perfil de cima
 * para baixo. `Record` fechado: slot novo em `SlotDeExibicao` sem rótulo aqui
 * não compila, e sem isso o item comprado sumiria da tela sem ninguém notar —
 * o defeito mais caro possível num produto que vende cosmético.
 */
const PRATELEIRAS: Readonly<Record<SlotDeExibicao, { titulo: string; vazio: string }>> = {
  moldura: { titulo: "Molduras", vazio: "Nenhuma moldura ainda." },
  cor_do_nome: {
    titulo: "Cores do nome",
    vazio: "Seu nome está na cor padrão, no perfil e nas listas.",
  },
  titulo: { titulo: "Títulos", vazio: "Nenhum título ainda." },
};

const ORDEM: SlotDeExibicao[] = ["moldura", "cor_do_nome", "titulo"];

export default async function InventarioPage({ searchParams }: PageProps<"/perfil/inventario">) {
  const session = await requirePlayer();
  const { erro, ok } = await searchParams;
  const itens = await getInventario(session.player.id);

  const consumiveis = itens.filter((i) => i.item.tipo === "consumivel");
  const badges = itens.filter((i) => i.item.tipo === "badge");
  const deSlot = itens.filter((i) => i.item.tipo !== "consumivel" && i.item.tipo !== "badge");
  const naVitrine = badges.filter((b) => b.naVitrine !== null);

  return (
    <div className="flex flex-col gap-7">
      <PageHeader
        titulo="Inventário"
        descricao="O que você comprou, e onde cada coisa está aparecendo."
        acao={
          <div className="flex gap-2">
            {/* O perfil público é o resultado de tudo que se escolhe aqui — e é
                a única tela onde dá para conferir se ficou como se queria. */}
            <LinkButton href={`/jogador/${session.player.slug}`} variante="ghost" tamanho="sm">
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
          <Section titulo="Vitrine">
            <p className="text-[12.5px] leading-[1.5] text-fg-4">
              As cinco vagas do seu perfil. A que estiver <strong>em destaque</strong> é a que sai
              daqui: ela aparece do lado do seu nome no ranking, na escalação e na lista de presença
              — os mesmos lugares por onde a cor do nome equipada também acompanha você.
            </p>
            <Vagas naVitrine={naVitrine} />
          </Section>

          <Section titulo="Badges">
            <HairlineList
              as="ul"
              vazio={
                <p className="text-[13px] text-fg-4">
                  Nenhum badge ainda — é o que a loja tem de mais bonito para gastar zenha.
                </p>
              }
            >
              {badges.map((badge) => (
                <li key={badge.inventarioId}>
                  <LinhaDeBadge badge={badge} vitrineCheia={naVitrine.length >= VAGAS_NA_VITRINE} />
                </li>
              ))}
            </HairlineList>
          </Section>

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
                vazio={<p className="text-[13px] text-fg-4">{PRATELEIRAS[slot].vazio}</p>}
              >
                {deSlot
                  .filter((c) => c.item.tipo === slot)
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
 * As cinco vagas, ocupadas ou não.
 *
 * As vazias são desenhadas em vez de omitidas: é assim que a tela diz quantas
 * ainda cabem sem precisar escrever um número, e é o que faz "vitrine cheia"
 * fazer sentido quando o banner aparecer.
 */
function Vagas({ naVitrine }: { naVitrine: ItemDoInventario[] }) {
  const porPosicao = new Map(naVitrine.map((b) => [b.naVitrine!.posicao, b]));

  return (
    <div className="grid grid-cols-5 gap-2">
      {Array.from({ length: VAGAS_NA_VITRINE }, (_, i) => i + 1).map((posicao) => {
        const ocupante = porPosicao.get(posicao);
        return (
          <div key={posicao} className="flex flex-col items-center gap-1.5">
            {ocupante ? (
              <>
                <ImagemDoItem item={ocupante.item} tamanho="md" />
                {/* `max-w-full` é o que faz o `truncate` cortar: numa coluna
                    `items-center` o span nasce com a largura do texto, e sem o
                    teto um nome longo atravessaria as vagas vizinhas. */}
                {ocupante.naVitrine!.destaque ? (
                  <Badge tom="accent" ponto>
                    destaque
                  </Badge>
                ) : (
                  <span className="max-w-full truncate text-[11px] text-fg-4">
                    {ocupante.item.nome}
                  </span>
                )}
              </>
            ) : (
              <>
                <span
                  aria-hidden
                  className="size-14 rounded-ctl border border-dashed border-dash bg-surface-2"
                />
                <span className="text-[11px] text-fg-faint">livre</span>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Um badge do inventário: entra e sai da vitrine, e pode virar o destaque. */
function LinhaDeBadge({
  badge,
  vitrineCheia,
}: {
  badge: ItemDoInventario;
  vitrineCheia: boolean;
}) {
  const posicao = badge.naVitrine;
  return (
    <HairlineRow className="items-center">
      <ImagemDoItem item={badge.item} tamanho="sm" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-display text-[14px] font-bold text-fg">
          {badge.item.nome}
        </span>
        <span className="mt-0.5 block text-[12px] text-fg-4">
          comprado em <span data-num>{formatDataDeCompra(badge.adquiridoEm)}</span> por{" "}
          <span data-num>{badge.precoPago.toLocaleString("pt-BR")}</span>
        </span>
      </span>

      {posicao ? (
        <>
          {posicao.destaque ? (
            <Badge tom="accent" ponto>
              em destaque
            </Badge>
          ) : (
            <form action={destacarBadge.bind(null, badge.inventarioId)}>
              <SubmitButton variante="secondary" tamanho="sm" labelPending="Destacando…">
                Destacar
              </SubmitButton>
            </form>
          )}
          <form action={tirarBadgeDaVitrine.bind(null, badge.inventarioId)}>
            <SubmitButton variante="ghost" tamanho="sm" labelPending="Tirando…">
              Tirar
            </SubmitButton>
          </form>
        </>
      ) : (
        <form action={porBadgeNaVitrine.bind(null, badge.inventarioId)}>
          <SubmitButton
            variante="secondary"
            tamanho="sm"
            labelPending="Pondo…"
            disabled={vitrineCheia}
            // Sem isto o botão desabilitado seria um botão morto sem explicação
            // — e o `disabled` já o tira da ordem de foco, então o texto ao lado
            // não chegaria a quem navega por leitor de tela.
            aria-label={
              vitrineCheia
                ? `${badge.item.nome}: a vitrine já tem ${VAGAS_NA_VITRINE} badges — tire um para pôr este`
                : `Pôr ${badge.item.nome} na vitrine`
            }
          >
            Pôr na vitrine
          </SubmitButton>
        </form>
      )}
    </HairlineRow>
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
      <PreviaDoItem item={guardado.item} tamanho="sm" />
      <span className="min-w-0 flex-1">
        <span className="block font-display text-[14px] font-bold text-fg">
          {guardado.item.nome}
        </span>
        <span className="mt-0.5 block text-[12.5px] text-fg-4">
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

/** Um cosmético de slot único: equipar troca quem estava lá; tirar deixa o slot vazio. */
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
      <PreviaDoItem item={cosmetico.item} tamanho="sm" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-display text-[14px] font-bold text-fg">
          {cosmetico.item.nome}
        </span>
        <span className="mt-0.5 block text-[12px] text-fg-4">
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
