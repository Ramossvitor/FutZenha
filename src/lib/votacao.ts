// Regra de apuração da votação de exclusão de fut. Pura de propósito: é a
// parte em que errar significa apagar (ou preservar) um fut indevidamente.

/** Fração de SIM sobre o eleitorado inteiro necessária para aprovar. */
export const QUORUM = 0.85;

/** Prazo da votação, em horas. */
export const PRAZO_VOTACAO_HORAS = 48;

/**
 * Depois do fim do prazo de contestação das notas, quanto tempo ainda dá para
 * abrir o pedido de exclusão do fut. Vencida essa janela, o fut fica no
 * histórico — só o admin da plataforma consegue apagá-lo.
 */
export const PRAZO_ABERTURA_EXCLUSAO_HORAS = 24;

/**
 * Quantos SIM a votação precisa. Arredonda para cima: com 10 eleitores, 85%
 * daria 8,5, e meio voto não existe — são 9.
 */
export function votosNecessarios(elegiveis: number): number {
  return Math.ceil(QUORUM * elegiveis);
}

export type EstadoVotacao = "open" | "approved" | "rejected";

export type PlacarVotacao = {
  elegiveis: number;
  sim: number;
  nao: number;
  /** Ainda não votaram. Silêncio conta contra. */
  pendentes: number;
  necessarios: number;
  /** Quantos SIM ainda faltam para aprovar. */
  faltam: number;
};

export function placar(elegiveis: number, sim: number, nao: number): PlacarVotacao {
  const necessarios = votosNecessarios(elegiveis);
  return {
    elegiveis,
    sim,
    nao,
    pendentes: Math.max(0, elegiveis - sim - nao),
    necessarios,
    faltam: Math.max(0, necessarios - sim),
  };
}

/**
 * Decide o destino da votação.
 *
 * Três saídas, nesta ordem:
 * 1. Atingiu o quórum → aprovada, mesmo antes do prazo.
 * 2. Nem se todos os pendentes votassem SIM daria → rejeitada na hora. Não faz
 *    sentido manter uma votação de pé por 48h quando o resultado já é certo.
 * 3. Prazo vencido sem quórum → rejeitada, porque o silêncio conta contra.
 *
 * Eleitorado vazio é caso à parte e não passa por aqui: sem ninguém afetado,
 * não há o que votar (ver src/lib/deletion.ts).
 */
export function avaliarVotacao(
  { elegiveis, sim, nao }: { elegiveis: number; sim: number; nao: number },
  prazoVencido: boolean,
): EstadoVotacao {
  const { necessarios, pendentes } = placar(elegiveis, sim, nao);
  if (sim >= necessarios) return "approved";
  if (sim + pendentes < necessarios) return "rejected";
  return prazoVencido ? "rejected" : "open";
}
