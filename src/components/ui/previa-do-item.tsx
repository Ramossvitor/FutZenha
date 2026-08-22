import type { CSSProperties } from "react";
import { cx } from "@/lib/cx";
import type { ItemDaLoja } from "@/lib/item-da-loja";
import { ChipDeTitulo } from "./chip-de-titulo";
import { IconePocao } from "./icons";
import { ImagemDoItem } from "./imagem-do-item";

/**
 * Como um item se mostra na loja, no inventário e no painel do admin.
 *
 * A regra é uma só e vale para os cinco tipos: a prévia é O EFEITO, e não um
 * desenho do efeito. Badge é a imagem que vai para o perfil; moldura é um anel
 * na cor comprada, igual ao que vai contornar o avatar; cor do nome é texto
 * naquela cor, no mesmo peso do apelido do cabeçalho; título é a cápsula que vai
 * aparecer ao lado do nome. Ninguém compra sem ver o que está comprando.
 *
 * O consumível é a única exceção, e não tinha como não ser: o efeito dele
 * acontece na nota de um fut, no futuro. Ele ganha um ícone que remete ao que
 * faz — uma poção — em vez de uma arte enviada, porque o admin não cria
 * consumível (o efeito é código).
 *
 * ── A cor vem do banco, então não pode virar classe ─────────────────────────
 *
 * `ring-(--cor-do-item)` com a cor entrando por `style` é obrigatório, não
 * estilo: o Tailwind gera utilitário VARRENDO O FONTE, e `ring-[${item.cor}]`
 * nunca existiria na folha final. É o mesmo mecanismo que a LinhaDeCampos usa
 * para as trilhas da grade, e a razão pela qual o antigo catálogo tinha uma
 * paleta fechada de sete cores em vez de hexadecimal livre.
 */
export function PreviaDoItem({
  item,
  tamanho = "lg",
  className,
}: {
  item: Pick<ItemDaLoja, "id" | "tipo" | "nome" | "cor" | "imagemHash">;
  tamanho?: "sm" | "lg";
  className?: string;
}) {
  const grande = tamanho === "lg";
  const cor = { "--cor-do-item": item.cor ?? "transparent" } as CSSProperties;

  switch (item.tipo) {
    case "badge":
      return <ImagemDoItem item={item} tamanho={grande ? "lg" : "sm"} className={className} />;

    case "moldura":
      // Um círculo vazio com o anel na cor: é literalmente o avatar sem as
      // iniciais. A borda cinza por baixo do anel existe para a moldura clara
      // não sumir no fundo claro — o mesmo que o Avatar faz.
      return (
        <span
          aria-hidden
          style={cor}
          className={cx(
            "inline-block shrink-0 rounded-full border border-line bg-surface-2 ring-2 ring-(--cor-do-item)",
            grande ? "size-20" : "size-8",
            className,
          )}
        />
      );

    case "cor_do_nome":
      // "Aa" no mesmo peso e largura do apelido do cabeçalho: quem está
      // comprando precisa ver a cor no tipo em que ela vai aparecer, não numa
      // amostra neutra.
      return (
        <span
          aria-hidden
          style={cor}
          className={cx(
            "inline-block font-display leading-none font-black font-stretch-125% text-(--cor-do-item) uppercase",
            grande ? "text-[44px]" : "text-[18px]",
            className,
          )}
        >
          Aa
        </span>
      );

    case "titulo":
      // `shrink-0` porque a cápsula tem a largura do NOME e vive em linhas de
      // lista ao lado de texto que encolhe: sem isto ela é a primeira a ceder e
      // o título sai espremido justamente na tela que existe para mostrá-lo.
      return <ChipDeTitulo nome={item.nome} className={cx("shrink-0", className)} />;

    case "consumivel":
      return (
        <IconePocao
          className={cx("shrink-0 text-warn-ink", grande ? "size-20" : "size-8", className)}
        />
      );

    default:
      // Tipo novo no enum sem prévia aqui não compila: sem esta linha o item
      // cairia da tela em silêncio, e o defeito seria "comprei e não apareceu" —
      // o pior possível numa loja.
      item.tipo satisfies never;
      return null;
  }
}
