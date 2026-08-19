import Link from "next/link";
import { cx } from "@/lib/cx";

/**
 * Como o produto escreve o nome de um jogador: o apelido manda, porque é como
 * o grupo chama a pessoa, e o nome de batismo vai embaixo, miúdo, para quem só
 * conhece de um jeito conseguir achar.
 *
 * Esta era a cópia mais duplicada da base — ranking, membros do grupo, lista de
 * presença, escalação e MVP tinham cada um a sua, com tamanhos que já haviam
 * divergido entre si.
 */
export function NomeJogador({
  apelido,
  nome,
  className,
}: {
  apelido: string | null;
  nome: string;
  className?: string;
}) {
  return (
    <span className={cx("min-w-0 flex-1", className)}>
      <Miolo apelido={apelido} nome={nome} />
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
  className,
}: {
  playerId: number;
  apelido: string | null;
  nome: string;
  className?: string;
}) {
  return (
    <Link
      href={`/jogador/${playerId}`}
      className={cx("group min-w-0 flex-1 rounded-ctl", className)}
    >
      <Miolo apelido={apelido} nome={nome} sublinhaNoHover />
    </Link>
  );
}

function Miolo({
  apelido,
  nome,
  sublinhaNoHover = false,
}: {
  apelido: string | null;
  nome: string;
  sublinhaNoHover?: boolean;
}) {
  return (
    <>
      <span
        className={cx(
          "block truncate font-display text-[14px] leading-[1.2] font-bold text-fg",
          sublinhaNoHover && "group-hover:underline",
        )}
      >
        {apelido ?? nome}
      </span>
      {apelido && <span className="block truncate text-[11.5px] text-fg-4">{nome}</span>}
    </>
  );
}
