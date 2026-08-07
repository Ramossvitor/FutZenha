import Link from "next/link";
import { cx } from "@/lib/cx";
import { Marca } from "./icons";

/**
 * O logotipo: o colete lime com a gola vazada, mais a palavra em Archivo
 * expandido. Substitui o "⚽ FutZenha" que existia — emoji não é marca, muda
 * de desenho a cada sistema.
 *
 * Mora no kit e não no shell porque a marca não é cromo de navegação: as telas
 * de entrada a usam sem ter sidebar nem abas. Enquanto estava em shell/, o
 * cartão de entrada fazia ui/ importar shell/, que importa ui/ de volta — e
 * todas as outras arestas entre os dois diretórios correm shell → ui.
 */
export function Wordmark({
  tamanho = "md",
  className,
}: {
  tamanho?: "sm" | "md" | "lg";
  className?: string;
}) {
  const marca = { sm: "h-[22px]", md: "h-[26px]", lg: "h-[38px]" }[tamanho];
  const texto = { sm: "text-[16px]", md: "text-[19px]", lg: "text-[30px]" }[tamanho];
  return (
    <span className={cx("inline-flex items-center gap-2", className)}>
      <Marca className={cx("w-auto text-accent", marca)} />
      <span
        className={cx(
          "font-display leading-none font-black font-stretch-125% tracking-[-.01em] text-fg uppercase",
          texto,
        )}
      >
        FutZenha
      </span>
    </span>
  );
}

export function WordmarkLink({
  tamanho = "md",
  className,
}: {
  tamanho?: "sm" | "md" | "lg";
  className?: string;
}) {
  return (
    <Link href="/" aria-label="FutZenha — início" className={className}>
      <Wordmark tamanho={tamanho} />
    </Link>
  );
}
