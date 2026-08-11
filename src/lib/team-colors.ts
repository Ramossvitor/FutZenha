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

/**
 * As variáveis CSS das mesmas sete cores, para quem precisa do VALOR e não da
 * classe — hoje só o confete do sorteio, que pinta num <canvas> e por isso não
 * tem utilitário do Tailwind para usar.
 *
 * Literal, e não `--vest-${chave}`, pela mesma razão que o COLETE é literal: a
 * regra deste arquivo é que nome de token não se monta por interpolação, e o
 * teste que a tranca lê o fonte inteiro. `Record<keyof typeof COLETE, …>` é o
 * que impede as duas tabelas de divergirem — colete novo lá sem entrada aqui
 * não compila.
 */
const VARIAVEL: Record<keyof typeof COLETE, string> = {
  preto: "--vest-preto",
  branco: "--vest-branco",
  verde: "--vest-verde",
  laranja: "--vest-laranja",
  azul: "--vest-azul",
  vermelho: "--vest-vermelho",
  amarelo: "--vest-amarelo",
};

/**
 * A variável CSS da cor do colete, ou null para nome inventado.
 *
 * Devolver null, e não uma cor de reserva, é de propósito: um time cujo chip
 * sai cinza de desconhecido não pode virar confete colorido — a chuva mentiria
 * sobre o que está na tela.
 */
export function varDoColete(nomeDoTime: string): string | null {
  const chave = nomeDoTime.trim().toLowerCase();
  return VARIAVEL[chave as keyof typeof COLETE] ?? null;
}

export const defaultTeamNames = ["Preto", "Branco", "Verde", "Laranja", "Azul", "Vermelho"];
