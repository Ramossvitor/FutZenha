import type { ReactNode } from "react";
import { cx } from "@/lib/cx";
import { resolverMensagem } from "@/lib/mensagens";

export type BannerTom = "erro" | "ok" | "info" | "aviso";

const tons: Record<BannerTom, string> = {
  erro: "border-danger-line bg-danger-tint text-danger-ink",
  ok: "border-accent-line bg-accent-tint text-accent-ink",
  info: "border-line bg-surface-2 text-fg-2",
  aviso: "border-warn-line bg-warn-tint text-warn-ink",
};

export function Banner({
  tom = "info",
  className,
  children,
}: {
  tom?: BannerTom;
  className?: string;
  children: ReactNode;
}) {
  return (
    <p
      role={tom === "erro" ? "alert" : "status"}
      className={cx(
        "rounded-ctl border px-3.5 py-2.5 text-[13px] leading-[1.5]",
        tons[tom],
        className,
      )}
    >
      {children}
    </p>
  );
}

/**
 * O banner de `?erro=` / `?ok=` que quase toda página precisa.
 *
 * Não renderiza nada quando o slug é desconhecido — e é justamente esse o caso
 * que o teste de cobertura em src/lib/mensagens.test.ts vigia, porque some sem
 * fazer barulho.
 *
 * `locais` deixa a página refinar um texto sem perder a rede de segurança do
 * dicionário global.
 */
export function BannerDaQuery({
  erro,
  ok,
  locais,
}: {
  erro?: string | string[];
  ok?: string | string[];
  locais?: Record<string, string>;
}) {
  const mensagemErro = resolverMensagem(erro, locais);
  if (mensagemErro) return <Banner tom="erro">{mensagemErro}</Banner>;

  const mensagemOk = resolverMensagem(ok, locais);
  if (mensagemOk) return <Banner tom="ok">{mensagemOk}</Banner>;

  return null;
}
