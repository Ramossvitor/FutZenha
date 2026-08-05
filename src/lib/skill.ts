// Motor da nota. Puro de propósito — sem banco, sem `server-only` — para que a
// fórmula e o arredondamento fiquem travados por teste (ver skill.test.ts).
//
// A nota de um jogador é sempre o replay completo do histórico: começa em 5,0 e
// aplica, na ordem das peladas, a média das avaliações válidas que ele recebeu
// em cada rodada. Nada de delta incremental — descartar uma avaliação antiga é
// só rodar o replay de novo sem ela.

// Escala interna: centésimos (1000 = 10,0). É a menor unidade em que o mapa
// linear das estrelas é exato — 2★ vale 3,25, que não cabe em décimos.
const CENTESIMOS = 100;

export const SKILL_INICIAL_CENT = 5 * CENTESIMOS;
export const SKILL_MIN_CENT = 1 * CENTESIMOS;
export const SKILL_MAX_CENT = 10 * CENTESIMOS;

// 1★ = 1,0 … 5★ = 10,0, linearmente: 1 + (estrelas - 1) × 2,25.
const ESTRELA_EM_CENTESIMOS = [null, 100, 325, 550, 775, 1000] as const;
export const ESTRELAS_MIN = 1;
export const ESTRELAS_MAX = 5;

// Peso da rodada sobre a nota: nova = (2 × atual + recebida) / 3.
// Mudar a inércia da nota é mudar estes dois números e rodar o replay.
//
// Efeito colateral que vale conhecer: arredondando para uma casa, a recorrência
// tem ponto fixo em 9,9 (todo mundo dando 5★) e em 1,1 (todo mundo dando 1★),
// alcançados em ~9 rodadas unânimes. Ou seja, 10,0 e 1,0 existem na escala mas
// são inalcançáveis pela fórmula — o clamp abaixo é só defesa contra dado ruim.
export const PESO_RODADA_NUM = 1;
export const PESO_RODADA_DEN = 3;

/**
 * Divisão inteira com arredondamento meio-para-cima. Todos os valores aqui são
 * positivos, então isto também é "meio para longe do zero".
 *
 * Fazer a mesma conta em ponto flutuante seria uma armadilha: `(5.65).toFixed(1)`
 * dá "5.7" mas `Math.round(5.65 * 10) / 10` dá 5.6. Duas regras diferentes no
 * mesmo sistema é como uma nota vira "por que deu 5,6?" sem resposta.
 */
function arredondar(dividendo: number, divisor: number): number {
  return Math.floor((2 * dividendo + divisor) / (2 * divisor));
}

function clamp(cent: number): number {
  return Math.min(SKILL_MAX_CENT, Math.max(SKILL_MIN_CENT, cent));
}

export function centParaNota(cent: number): number {
  return cent / CENTESIMOS;
}

export function notaParaCent(nota: number): number {
  return Math.round(nota * CENTESIMOS);
}

export type RatingInput = {
  raterPlayerId: number;
  ratedPlayerId: number;
  stars: number;
};

export type RoundInput = {
  roundId: number;
  matchDayId: number;
  /** "YYYY-MM-DD" — a data da pelada, que é o que ordena o replay. */
  matchDayDate: string;
  /** Só as avaliações válidas. Filtrar as descartadas é do chamador. */
  ratings: RatingInput[];
};

export type SkillChange = {
  playerId: number;
  roundId: number;
  /** Nota antes e depois, já na escala 1–10 com uma casa. */
  before: number;
  after: number;
  ratingsCount: number;
  averageReceived: number;
};

export type ReplayResult = {
  /** Nota final de cada jogador que recebeu alguma avaliação válida. */
  skillByPlayer: Map<number, number>;
  /**
   * Uma linha por (jogador, rodada) em que ele recebeu avaliação válida —
   * inclusive quando a nota não se moveu, porque a rodada aconteceu e o
   * histórico é registro de auditoria. Quem notifica filtra por before ≠ after.
   * Ordenado por rodada e, dentro dela, por playerId.
   */
  history: SkillChange[];
};

/**
 * Ordem canônica das rodadas: data da pelada, depois id da pelada, depois id da
 * rodada. Nunca a data de apuração — a nota tem que ser função das avaliações
 * válidas, não de quando o admin clicou em apurar. É o que torna o replay
 * auditável e o resultado independente da ordem em que as rodadas chegam.
 */
function ordenar(rounds: RoundInput[]): RoundInput[] {
  return [...rounds].sort(
    (a, b) =>
      a.matchDayDate.localeCompare(b.matchDayDate) ||
      a.matchDayId - b.matchDayId ||
      a.roundId - b.roundId,
  );
}

// O banco já barra os três casos (check de stars, check de rater <> rated,
// unique do par). Falhar alto aqui é o que denuncia dado corrompido em vez de
// deixá-lo virar nota silenciosamente errada.
function validar(round: RoundInput): void {
  const vistos = new Set<string>();
  for (const r of round.ratings) {
    if (!Number.isInteger(r.stars) || r.stars < ESTRELAS_MIN || r.stars > ESTRELAS_MAX) {
      throw new Error(`Rodada ${round.roundId}: estrelas inválidas (${r.stars})`);
    }
    if (r.raterPlayerId === r.ratedPlayerId) {
      throw new Error(`Rodada ${round.roundId}: jogador ${r.raterPlayerId} avaliou a si mesmo`);
    }
    const chave = `${r.raterPlayerId}:${r.ratedPlayerId}`;
    if (vistos.has(chave)) {
      throw new Error(`Rodada ${round.roundId}: avaliação duplicada (${chave})`);
    }
    vistos.add(chave);
  }
}

export function replaySkills(rounds: RoundInput[]): ReplayResult {
  const notaCent = new Map<number, number>();
  const history: SkillChange[] = [];

  for (const round of ordenar(rounds)) {
    validar(round);

    // Soma das estrelas recebidas por jogador avaliado nesta rodada.
    const recebidas = new Map<number, { somaCent: number; total: number }>();
    for (const r of round.ratings) {
      const acc = recebidas.get(r.ratedPlayerId) ?? { somaCent: 0, total: 0 };
      acc.somaCent += ESTRELA_EM_CENTESIMOS[r.stars]!;
      acc.total += 1;
      recebidas.set(r.ratedPlayerId, acc);
    }

    // Ordenar por playerId mantém o histórico estável entre execuções.
    const avaliados = [...recebidas.keys()].sort((a, b) => a - b);
    for (const playerId of avaliados) {
      const { somaCent, total } = recebidas.get(playerId)!;
      const atualCent = notaCent.get(playerId) ?? SKILL_INICIAL_CENT;
      const mediaCent = arredondar(somaCent, total);

      // nova = (2 × atual + recebida) / 3, arredondada direto para décimos —
      // um arredondamento só, na casa que a nota realmente tem.
      const decimos = arredondar(
        (PESO_RODADA_DEN - PESO_RODADA_NUM) * atualCent + PESO_RODADA_NUM * mediaCent,
        PESO_RODADA_DEN * 10,
      );
      const novaCent = clamp(decimos * 10);

      notaCent.set(playerId, novaCent);
      history.push({
        playerId,
        roundId: round.roundId,
        before: centParaNota(atualCent),
        after: centParaNota(novaCent),
        ratingsCount: total,
        averageReceived: centParaNota(mediaCent),
      });
    }
  }

  const skillByPlayer = new Map<number, number>();
  for (const [playerId, cent] of notaCent) skillByPlayer.set(playerId, centParaNota(cent));
  return { skillByPlayer, history };
}
