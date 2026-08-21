import { cx } from "@/lib/cx";
import type { ItemDaLoja } from "@/lib/loja-catalogo";
import { CLASSES_DO_TOKEN } from "./tokens-de-item";

/**
 * O item comprado, escrito.
 *
 * ── Por que não é um Badge com outra cor ────────────────────────────────────
 *
 * O Badge diz o que a pessoa É pelas regras do app: goleiro, você, sem conta,
 * fora das listas. O Selo diz o que ela COMPROU. São duas autoridades
 * diferentes, e o perfil mostra as duas coisas a 8px uma da outra — um selo
 * "Defesa do ano" indistinguível do badge "goleiro" faria o app parecer estar
 * afirmando que ela ganhou alguma coisa em campo.
 *
 * Por isso a diferença é de SILHUETA, e não de paleta: o Badge é retângulo de
 * canto miúdo, preenchido com o tint do papel, texto de 10px em Archivo
 * condensado, caixa alta e muito espaçado — um carimbo. O Selo é cápsula
 * redonda, sem preenchimento, com o nome em caixa mista, 11,5px e Archivo
 * ESTENDIDO, aberto por um losango na cor do item. Nenhum dos dois eixos
 * (forma, preenchimento, largura da fonte, caixa) coincide, então a distinção
 * sobrevive ao daltonismo, ao print em preto e branco e à visão periférica —
 * cor sozinha não sobreviveria a nenhum dos três.
 *
 * (O `rounded-selo` do design é o raio de 3px do Badge; o nome é anterior a
 * este componente e não tem nada a ver com ele.)
 *
 * O nome vai escrito porque é ele que carrega a piada: item cosmético sem texto
 * viraria um ícone que só o dono entende. Quem passa o mouse não ganha tooltip
 * nenhuma — a descrição do catálogo é da vitrine, não da vitrine alheia.
 */
export function Selo({
  item,
  className,
}: {
  /** O item do catálogo. `Pick` porque só o nome e a cor entram no desenho. */
  item: Pick<ItemDaLoja, "nome" | "tokenId">;
  className?: string;
}) {
  const cores = CLASSES_DO_TOKEN[item.tokenId];
  return (
    <span
      className={cx(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border bg-transparent px-2.5 py-[3px] font-display text-[11.5px] leading-[1.35] font-bold font-stretch-112%",
        cores.texto,
        cores.borda,
        className,
      )}
    >
      {/* Quadrado girado, e não o ponto do Badge: é o segundo sinal de que as
          duas coisas não são a mesma, e ele funciona mesmo com o selo cortado
          pela dobra da tela. `aria-hidden` porque o nome vem logo ao lado. */}
      <span aria-hidden className={cx("size-[5px] shrink-0 rotate-45", cores.fundo)} />
      {item.nome}
    </span>
  );
}
