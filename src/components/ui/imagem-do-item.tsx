import { cx } from "@/lib/cx";
import { urlDaImagemDoItem, type ItemDaLoja } from "@/lib/item-da-loja";

/**
 * A imagem de um badge — a arte que o admin enviou e que o jogador ostenta.
 *
 * É o componente mais importante da loja nova: nos badges, isto NÃO ilustra o
 * produto, isto É o produto. O que aparece aqui é byte a byte o que vai para o
 * perfil e para o lado do nome nas listas.
 *
 * ── `<img>` cru, e não `next/image` ─────────────────────────────────────────
 *
 * O app inteiro não usa `next/image` e este não é o lugar de estrear: os bytes
 * vêm da nossa própria rota já em 256×256 (o formulário do admin recorta antes
 * de enviar), então não há o que redimensionar; a URL carrega o hash do
 * conteúdo, então o cache já é imutável sem ajuda; e a otimização de imagem da
 * Vercel é cota no plano Hobby, que é conta que este projeto decidiu não ter. O
 * `@next/next/no-img-element` fica desligado para este arquivo no
 * eslint.config.mjs, com a mesma cerimônia do google-button.
 */

export type TamanhoDaImagem = "mini" | "sm" | "md" | "lg";

/**
 * O `size-*` e o `width`/`height` andam juntos de propósito: a classe é quem
 * desenha, e os atributos são o que reserva o espaço ANTES de o byte chegar —
 * sem eles a lista de ranking pula quando as imagens carregam.
 */
const TAMANHOS: Readonly<Record<TamanhoDaImagem, { classe: string; px: number }>> = {
  /** Ao lado do nome, em ranking e escalação. */
  mini: { classe: "size-4 rounded-[3px]", px: 16 },
  /** Numa linha de lista — inventário, painel do admin. */
  sm: { classe: "size-8 rounded-ctl", px: 32 },
  /** Numa vaga da vitrine. */
  md: { classe: "size-14 rounded-ctl", px: 56 },
  /** No card da loja e no perfil, onde a arte é o assunto. */
  lg: { classe: "size-24 rounded-ctl", px: 96 },
};

export function ImagemDoItem({
  item,
  tamanho,
  decorativa = false,
  className,
}: {
  item: Pick<ItemDaLoja, "id" | "nome" | "imagemHash">;
  tamanho: TamanhoDaImagem;
  /**
   * `true` quando o nome do item já está escrito ao lado — é o caso do destaque
   * junto do nome do jogador, onde o `alt` repetiria em voz alta um enfeite. Sem
   * isto, o leitor de tela leria "Avaí" antes de cada nome do ranking.
   */
  decorativa?: boolean;
  className?: string;
}) {
  const url = urlDaImagemDoItem(item);
  if (url === null) return null;

  const { classe, px } = TAMANHOS[tamanho];
  return (
    // `<img>` e não next/image: a isenção do `no-img-element` para este arquivo
    // está no eslint.config.mjs, com o porquê escrito lá e no cabeçalho daqui.
    <img
      src={url}
      alt={decorativa ? "" : item.nome}
      title={decorativa ? item.nome : undefined}
      width={px}
      height={px}
      loading="lazy"
      decoding="async"
      // `object-cover` porque o servidor confere formato e tamanho, não
      // proporção: quem posta sem passar pelo formulário pode mandar retângulo,
      // e esticar seria pior que cortar.
      className={cx("shrink-0 bg-surface-2 object-cover", classe, className)}
    />
  );
}
