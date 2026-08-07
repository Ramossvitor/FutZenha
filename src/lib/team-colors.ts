// Nome de time é cor de colete. `teams.name` é TEXT livre no banco — não há
// enum nem check —, então tudo aqui precisa aguentar um "Roxo" ou um "Time A"
// que alguém inventou.

/**
 * As classes do chip de cada colete.
 *
 * Strings completas e literais de propósito: o Tailwind gera utilitário
 * varrendo o código-fonte, então `bg-vest-${time.name}` nunca existiria no CSS
 * final. Interpolar aqui é um bug silencioso — o chip sai sem cor nenhuma.
 */
const COLETE = {
  preto: "bg-vest-preto border-vest-preto-line",
  branco: "bg-vest-branco border-vest-branco-line",
  verde: "bg-vest-verde border-vest-verde-line",
  laranja: "bg-vest-laranja border-vest-laranja-line",
  azul: "bg-vest-azul border-vest-azul-line",
  vermelho: "bg-vest-vermelho border-vest-vermelho-line",
  amarelo: "bg-vest-amarelo border-vest-amarelo-line",
} as const;

const COLETE_DESCONHECIDO = "bg-surface-2 border-line-strong";

/**
 * As classes de preenchimento e borda do colete, para o retângulo colorido.
 *
 * O preenchimento é a cor da camisa e é igual nos dois temas; quem garante os
 * 3:1 contra a superfície é a borda, que troca com o tema. Por isso as duas
 * saem sempre juntas — usar só o `bg-` deixa o colete Preto invisível no tema
 * escuro (1,04:1) e o Branco invisível no claro.
 */
export function colete(nomeDoTime: string): string {
  const chave = nomeDoTime.trim().toLowerCase();
  return COLETE[chave as keyof typeof COLETE] ?? COLETE_DESCONHECIDO;
}

export const defaultTeamNames = ["Preto", "Branco", "Verde", "Laranja", "Azul", "Vermelho"];

// LEGADO — as telas antigas ainda montam o colete como pílula com o nome
// dentro, o que exige uma cor de texto. O design novo separa as duas coisas
// (retângulo de cor + rótulo ao lado), então isto morre junto com a reescrita
// da tela da pelada. Não use em código novo.
const colorMap: Record<string, string> = {
  preto: "bg-neutral-900 text-white",
  branco: "bg-white text-neutral-900 border border-neutral-300",
  verde: "bg-emerald-600 text-white",
  azul: "bg-blue-600 text-white",
  vermelho: "bg-red-600 text-white",
  laranja: "bg-orange-500 text-white",
  amarelo: "bg-yellow-400 text-neutral-900",
};

/** @deprecated Use `colete()`. Removido quando a tela da pelada for reescrita. */
export function vestClass(teamName: string): string {
  return colorMap[teamName.trim().toLowerCase()] ?? "bg-neutral-500 text-white";
}
