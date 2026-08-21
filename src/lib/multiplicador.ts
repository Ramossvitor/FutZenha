// As decisões do multiplicador. Puro de propósito — sem banco, sem
// `server-only` — porque é aqui que mora o antiabuso, e antiabuso sem teste é
// promessa.
//
// ── O problema que este arquivo resolve ────────────────────────────────────
// O fut é encerrado horas depois de acabar fisicamente. Quem esperasse o
// encerramento para armar o multiplicador já saberia como jogou — e uma aposta
// cujo resultado se conhece antes de apostar não é aposta, é saque.
//
// A trava é: armar só vale ANTES da bola rolar. E ela precisa valer nas duas
// pontas — armar e DESARMAR. Sem a guarda no desarme, o caminho é trivial:
// arma na sexta, joga mal no sábado, desarma no domingo antes do encerramento.
//
// ── Por que o corte é congelado ────────────────────────────────────────────
// O admin pode mexer na data e na hora do fut depois de alguém armar. O corte
// que vale é o MENOR entre o que estava combinado no arme, o horário atual do
// fut, e a primeira evidência de que a bola rolou. Adiar o fut não abre janela
// nenhuma; antecipar invalida o arme e devolve o item.

/** Por que um multiplicador armado não virou fato ao encerrar o fut. */
export type MotivoDaDevolucao =
  /** Armou e não entrou em campo — nem por falta, nem por ter saído da lista. */
  | "nao-jogou"
  /** O fut encerrou sem rodada de avaliação: não há nota para multiplicar. */
  | "sem-rodada"
  /** Houve rodada, mas ninguém avaliou este jogador — a nota dele não se moveu. */
  | "sem-avaliacao"
  /** O corte foi antecipado (o fut mudou de data) e o arme ficou depois dele. */
  | "corte-antecipado"
  /**
   * O fut passou da hora e nunca foi encerrado. Não é desfecho de encerramento
   * como os outros — vem da varredura, que é o único jeito de o item voltar de
   * um fut que ninguém fechou. Ver `soltarArmesDeFutsAbandonados`.
   */
  | "fut-abandonado";

export const TEXTO_DA_DEVOLUCAO: Record<MotivoDaDevolucao, string> = {
  "nao-jogou": "Você não entrou em campo, então o multiplicador voltou para o seu inventário.",
  "sem-rodada":
    "O fut encerrou sem avaliação, então não havia nota para multiplicar — o item voltou para você.",
  "sem-avaliacao":
    "Ninguém avaliou você neste fut, então sua nota não se moveu — o multiplicador voltou.",
  "corte-antecipado":
    "O horário do fut foi antecipado para antes de você armar, então o multiplicador voltou.",
  "fut-abandonado":
    "O fut passou e não foi encerrado, então o multiplicador voltou para o seu inventário.",
};

/** O que se sabe sobre um arme na hora de decidir se ele vale. */
export type ArmeParaAvaliar = {
  /** Quando a pessoa armou. */
  armadoEm: Date;
  /**
   * O corte combinado NO ARME — o horário de início do fut naquele momento.
   * Congelado para adiar o fut depois não abrir janela.
   */
  cortePrevisto: Date;
  /** O horário de início do fut AGORA, que pode ter sido mudado desde o arme. */
  kickoffAtual: Date;
  /**
   * A primeira evidência independente de que a bola rolou: o maior entre a
   * meia-noite do dia do fut e o instante do primeiro jogo lançado. Existe
   * porque o horário marcado pode simplesmente não corresponder à realidade.
   */
  primeiroSinalDeBola: Date;
};

/**
 * O instante até o qual armar (ou desarmar) ainda vale.
 *
 * O MENOR dos três é conservador nos dois sentidos, e essa assimetria é
 * intencional: adiar o fut não pode abrir janela para quem já sabe como jogou,
 * e antecipar tem que invalidar em vez de aceitar às cegas.
 */
export function corteEfetivo(arme: Omit<ArmeParaAvaliar, "armadoEm">): Date {
  return new Date(
    Math.min(
      arme.cortePrevisto.getTime(),
      arme.kickoffAtual.getTime(),
      arme.primeiroSinalDeBola.getTime(),
    ),
  );
}

/** O arme aconteceu a tempo? */
export function armadoATempo(arme: ArmeParaAvaliar): boolean {
  return arme.armadoEm.getTime() < corteEfetivo(arme).getTime();
}

/** O que se sabe sobre o jogador quando o fut encerra. */
export type SituacaoNoEncerramento = {
  /** Entrou em campo — tem linha em `game_players`. */
  jogou: boolean;
  /** O encerramento abriu rodada de avaliação. */
  houveRodada: boolean;
};

/**
 * O multiplicador vira fato, ou volta para o inventário?
 *
 * `null` quer dizer "vale" — grava o fato e consome o item. Qualquer outra
 * coisa é o motivo da devolução, que vai no aviso.
 *
 * A ausência de avaliação NÃO é decidida aqui: no encerramento ainda não se
 * sabe quem vai ser avaliado (a rodada acabou de abrir). Esse caso é resolvido
 * na liquidação, quando `skill_history` já existe — ver
 * `src/lib/zenha-engine.ts`.
 */
export function decidirNoEncerramento(
  arme: ArmeParaAvaliar,
  situacao: SituacaoNoEncerramento,
): MotivoDaDevolucao | null {
  if (!armadoATempo(arme)) return "corte-antecipado";
  if (!situacao.jogou) return "nao-jogou";
  if (!situacao.houveRodada) return "sem-rodada";
  return null;
}
