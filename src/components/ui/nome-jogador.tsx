import type { CSSProperties } from "react";
import Link from "next/link";
import { cx } from "@/lib/cx";
import type { CosmeticosDoNome, DestaqueDoJogador } from "@/lib/loja";
import { ImagemDoItem } from "./imagem-do-item";

/**
 * Como o produto escreve o nome de um jogador: o apelido manda, porque é como
 * o grupo chama a pessoa, e o nome de batismo vai embaixo, miúdo, para quem só
 * conhece de um jeito conseguir achar.
 *
 * Esta era a cópia mais duplicada da base — ranking, membros do grupo, lista de
 * presença, escalação e MVP tinham cada um a sua, com tamanhos que já haviam
 * divergido entre si.
 *
 * ── Os cosméticos que andam junto do nome ───────────────────────────────────
 *
 * São dois, e são os únicos que saem do perfil e circulam pelo app: o badge em
 * destaque e a cor do nome. Cabem aqui — e o título não coube — porque nenhum
 * dos dois tem largura imprevisível: o badge é imagem de 16px e a cor não ocupa
 * espaço NENHUM. Nem um nem outro empurra a nota para fora da tela no celular ou
 * muda a altura da linha, e os dois somem sozinhos quando ninguém equipou nada.
 *
 * A cor era o buraco óbvio: comprar "seu nome, na cor que você escolher" e ver o
 * efeito só numa tela que o dono visita sozinho, enquanto a lista de presença —
 * onde o grupo inteiro olha — desenhava todo mundo igual.
 *
 * A prop é opcional e sem valor padrão, e sem ela nada muda no desenho — mas o
 * invólucro mudou para TODO chamador: o nome vive num `flex` (ver o Miolo), com
 * ou sem badge, e é o e2e/alinhamento.spec.ts quem guarda que as listas não
 * saíram do lugar. Quem quer mostrar carrega os cosméticos de TODA a lista de uma
 * vez (`lerCosmeticosDoNome`) e passa o Map para baixo — uma consulta por linha
 * para enfeitar um ranking seria o custo que fez esta prop não existir antes.
 */
export function NomeJogador({
  apelido,
  nome,
  cosmeticos,
  className,
}: {
  apelido: string | null;
  nome: string;
  cosmeticos?: CosmeticosDoNome | null;
  className?: string;
}) {
  return (
    <span className={cx("min-w-0 flex-1", className)}>
      <Miolo apelido={apelido} nome={nome} cosmeticos={cosmeticos} />
    </span>
  );
}

/**
 * O mesmo nome, levando ao perfil público.
 *
 * A âncora é o nome, e não a linha inteira, porque nas telas onde ele aparece a
 * linha carrega outras coisas — nota, selo de goleiro, botão de presença — e
 * envolver tudo num link roubaria o alvo de toque delas. Onde a linha é só o
 * jogador (membros do grupo), o `HairlineRowLink` continua sendo o certo.
 */
export function LinkJogador({
  slug,
  apelido,
  nome,
  cosmeticos,
  className,
}: {
  /** O endereço público do jogador — `players.slug`, nunca o id. */
  slug: string;
  apelido: string | null;
  nome: string;
  cosmeticos?: CosmeticosDoNome | null;
  className?: string;
}) {
  return (
    <Link
      href={`/jogador/${slug}`}
      className={cx("group min-w-0 flex-1 rounded-ctl", className)}
    >
      <Miolo apelido={apelido} nome={nome} cosmeticos={cosmeticos} sublinhaNoHover />
    </Link>
  );
}

/**
 * A cor comprada, para quem desenha o nome à mão.
 *
 * Devolve o par `style`/`className` porque a cor vem de uma COLUNA: o Tailwind
 * varre o fonte para gerar a folha, então `text-[${cor}]` nunca existiria nela —
 * o valor tem que entrar por custom property e a classe tem que ser literal (ver
 * previa-do-item.tsx). As duas strings estão aqui, escritas, e é isso que faz o
 * Tailwind emitir a regra.
 *
 * A cor SUBSTITUI o `text-fg`, não se soma a ele. Contraste é de quem cadastrou
 * a cor no admin: o app não tem mais uma paleta fechada para garanti-lo, e a
 * regra é a mesma do perfil desde que o cosmético existe.
 */
export function pinturaDoNome(cor?: string | null): {
  style?: CSSProperties;
  className: string;
} {
  if (!cor) return { className: "text-fg" };
  return {
    style: { "--cor-do-nome": cor } as CSSProperties,
    className: "text-(--cor-do-nome)",
  };
}

/**
 * O badge em destaque, para quem desenha o nome à mão.
 *
 * Existe por causa das duas células de tabela do rankings.tsx que
 * deliberadamente não usam o `NomeJogador` (elas têm layout próprio). Sem isto,
 * as duas voltariam a montar o `<img>` por conta — que é exatamente a
 * duplicação que o `NomeJogador` foi criado para acabar.
 */
export function DestaqueNoNome({ destaque }: { destaque?: DestaqueDoJogador | null }) {
  if (!destaque) return null;
  return (
    <ImagemDoItem
      item={{ id: destaque.itemId, nome: destaque.nome, imagemHash: destaque.imagemHash }}
      tamanho="mini"
      decorativa
    />
  );
}

function Miolo({
  apelido,
  nome,
  cosmeticos,
  sublinhaNoHover = false,
}: {
  apelido: string | null;
  nome: string;
  cosmeticos?: CosmeticosDoNome | null;
  sublinhaNoHover?: boolean;
}) {
  const pintura = pinturaDoNome(cosmeticos?.cor);
  return (
    <>
      {/* O `flex` com `min-w-0` no texto, e não a imagem solta antes do span: o
          `truncate` só funciona sobre um filho que possa encolher, e sem o
          min-w-0 o nome longo empurraria o badge para fora da linha em vez de
          cortar a si mesmo. */}
      <span className="flex items-center gap-1.5">
        <DestaqueNoNome destaque={cosmeticos?.destaque} />
        {/* Só o apelido é pintado. O nome de batismo de baixo continua `fg-4`,
            como no perfil: lá o h1 leva a cor e o `<p>` não. É o que mantém a
            linha legível quando a cor comprada é fraca. */}
        <span
          style={pintura.style}
          className={cx(
            "min-w-0 truncate font-display text-[14px] leading-[1.2] font-bold",
            pintura.className,
            sublinhaNoHover && "group-hover:underline",
          )}
        >
          {apelido ?? nome}
        </span>
      </span>
      {apelido && <span className="block truncate text-[11.5px] text-fg-4">{nome}</span>}
    </>
  );
}
