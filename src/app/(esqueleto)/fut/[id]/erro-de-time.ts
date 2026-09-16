import type { ErroAoEditarTime } from "@/lib/times-do-fut";

/**
 * A query string de cada recusa de atualizarTime — com o `?erro=` DENTRO do
 * literal, um por caso, para o mensagens.test.ts enxergar os slugs emitidos
 * (o mesmo arranjo de admin/(panel)/loja/actions.ts). Mora aqui, e não em
 * src/lib, porque o teste só varre src/app; e num arquivo à parte porque os
 * dois emissores (o /gerenciar e a súmula) são "use server" e só exportam
 * funções async — como revalidate.ts, ao lado.
 */
export function queryDoErroDeTime(erro: ErroAoEditarTime): string {
  switch (erro) {
    case "dados-invalidos":
      return "?erro=dados-invalidos";
    case "nome-de-time-repetido":
      return "?erro=nome-de-time-repetido";
    case "escalacao-travada":
      return "?erro=escalacao-travada";
    default:
      erro satisfies never;
      return "?erro=dados-invalidos";
  }
}
