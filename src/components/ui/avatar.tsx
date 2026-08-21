import { cx } from "@/lib/cx";
import { iniciais } from "@/lib/iniciais";
import type { TokenDeItem } from "@/lib/loja-catalogo";
import { CLASSES_DO_TOKEN } from "./tokens-de-item";

export type TamanhoAvatar = "sm" | "md" | "lg";

const tamanhos: Record<TamanhoAvatar, string> = {
  sm: "size-7 text-[10px]",
  md: "size-9 text-[12px]",
  lg: "size-11 text-[14px]",
};

/**
 * Avatar de iniciais.
 *
 * Não existe campo de foto em players, users nem groups — não é uma
 * simplificação, é o que o banco tem. `aria-hidden` porque o nome aparece
 * escrito ao lado em todos os usos; um leitor de tela soletrando "MV" antes de
 * "Marcos Vinícius" só atrapalha.
 */
export function Avatar({
  nome,
  tamanho = "md",
  moldura,
  className,
}: {
  nome: string;
  tamanho?: TamanhoAvatar;
  /**
   * O token da moldura comprada na loja, quando existe uma equipada.
   *
   * Opcional e sem valor padrão para que os ~15 avatares que já existem no app
   * saiam byte a byte como saíam: sem a prop, nem `ring-2` nem cor entram na
   * string de classes. Aceita `null` porque quem chama lê o slot do banco, e
   * `equipados.moldura?.tokenId ?? null` é mais honesto que um ternário.
   */
  moldura?: TokenDeItem | null;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-full border border-line bg-surface-2 font-display font-bold text-fg-3",
        tamanhos[tamanho],
        // Anel sem `ring-offset`: o offset precisa saber a cor do que está ATRÁS
        // do avatar para desenhar o vão, e o mesmo avatar aparece sobre canvas,
        // surface e surface-2. Chutar uma delas desenha um halo errado nas
        // outras duas; encostado na borda o anel lê como aro em qualquer fundo.
        moldura && cx("ring-2", CLASSES_DO_TOKEN[moldura].anel),
        className,
      )}
    >
      {iniciais(nome)}
    </span>
  );
}

/**
 * Pilha de avatares sobrepostos, com um "+N" no fim quando sobra gente.
 * O `limite` corta a lista; o total vem separado porque quem chama costuma
 * saber quantos são sem ter carregado todos.
 */
export function AvatarPilha({
  nomes,
  limite = 5,
  className,
}: {
  nomes: string[];
  limite?: number;
  className?: string;
}) {
  const mostrados = nomes.slice(0, limite);
  const resto = nomes.length - mostrados.length;
  return (
    <span className={cx("flex items-center", className)}>
      {mostrados.map((nome, i) => (
        <Avatar
          key={`${nome}-${i}`}
          nome={nome}
          tamanho="sm"
          className="-ml-1.5 ring-2 ring-surface first:ml-0"
        />
      ))}
      {resto > 0 && (
        <span
          aria-hidden
          className="-ml-1.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-line bg-surface-2 font-display text-[10px] font-bold text-fg-3 ring-2 ring-surface"
        >
          +{resto}
        </span>
      )}
    </span>
  );
}
