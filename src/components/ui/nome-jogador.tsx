import Link from "next/link";
import { cx } from "@/lib/cx";
import type { DestaqueDoJogador } from "@/lib/loja";
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
 * ── O destaque ──────────────────────────────────────────────────────────────
 *
 * É o único cosmético comprado que sai do perfil e circula pelo app: um badge de
 * 16px que o jogador escolheu, no meio de listas que não são sobre ele. Cabe
 * aqui — e o título não coube — porque é imagem de tamanho fixo: não empurra a
 * nota para fora da tela no celular, não muda a altura da linha, e some sozinho
 * quando ninguém escolheu nenhum.
 *
 * A prop é opcional e sem valor padrão, e sem ela nada é desenhado a mais — mas
 * o invólucro mudou para TODO chamador: o nome agora vive num `flex` (ver o
 * Miolo), com ou sem badge, e é o e2e/alinhamento.spec.ts quem guarda que as
 * listas não saíram do lugar. Quem quer mostrar carrega os destaques de TODA a
 * lista de uma vez (`lerDestaques`) e passa o Map para baixo — uma consulta por
 * linha para enfeitar um ranking seria o custo que fez esta prop não existir
 * antes.
 */
export function NomeJogador({
  apelido,
  nome,
  destaque,
  className,
}: {
  apelido: string | null;
  nome: string;
  destaque?: DestaqueDoJogador | null;
  className?: string;
}) {
  return (
    <span className={cx("min-w-0 flex-1", className)}>
      <Miolo apelido={apelido} nome={nome} destaque={destaque} />
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
  playerId,
  apelido,
  nome,
  destaque,
  className,
}: {
  playerId: number;
  apelido: string | null;
  nome: string;
  destaque?: DestaqueDoJogador | null;
  className?: string;
}) {
  return (
    <Link
      href={`/jogador/${playerId}`}
      className={cx("group min-w-0 flex-1 rounded-ctl", className)}
    >
      <Miolo apelido={apelido} nome={nome} destaque={destaque} sublinhaNoHover />
    </Link>
  );
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
  destaque,
  sublinhaNoHover = false,
}: {
  apelido: string | null;
  nome: string;
  destaque?: DestaqueDoJogador | null;
  sublinhaNoHover?: boolean;
}) {
  return (
    <>
      {/* O `flex` com `min-w-0` no texto, e não a imagem solta antes do span: o
          `truncate` só funciona sobre um filho que possa encolher, e sem o
          min-w-0 o nome longo empurraria o badge para fora da linha em vez de
          cortar a si mesmo. */}
      <span className="flex items-center gap-1.5">
        <DestaqueNoNome destaque={destaque} />
        <span
          className={cx(
            "min-w-0 truncate font-display text-[14px] leading-[1.2] font-bold text-fg",
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
