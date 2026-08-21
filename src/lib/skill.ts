// Motor da nota. Puro de propósito — sem banco, sem `server-only` — para que a
// fórmula e o arredondamento fiquem travados por teste (ver skill.test.ts).
//
// A nota de um jogador é sempre o replay completo do histórico: começa em 5,0 e
// aplica, na ordem dos futs, a média das avaliações válidas que ele recebeu
// em cada rodada. Nada de delta incremental — descartar uma avaliação antiga é
// só rodar o replay de novo sem ela.

// Escala interna: centésimos (1000 = 10,0). Na régua atual bastariam décimos,
// mas a tabela legada tem 2★ = 3,25 — que não cabe em décimos — e ela nunca
// sai do sistema: toda rodada `legacy_scale` do banco passa por aqui a cada
// replay, para sempre.
const CENTESIMOS = 100;

export const SKILL_INICIAL_CENT = 5 * CENTESIMOS;
export const SKILL_MIN_CENT = 1 * CENTESIMOS;
export const SKILL_MAX_CENT = 10 * CENTESIMOS;

// A unidade do voto é MEIA ESTRELA inteira: 1 = 0,5★ … 10 = 5★. Régua atual:
// cada meia vale 1 ponto (cent = meias × 100), então 0,5★ = 1,0 e 5★ = 10,0.
export const MEIAS_MIN = 1;
export const MEIAS_MAX = 10;

// Régua congelada das rodadas apuradas antes da meia estrela (legacy_scale):
// 1★ = 1,0 … 5★ = 10,0, linearmente 1 + (estrelas - 1) × 2,25. Indexada por
// ESTRELAS INTEIRAS (meias / 2) — nessas rodadas só existem meias pares.
const LEGADO_EM_CENTESIMOS = [null, 100, 325, 550, 775, 1000] as const;

// Peso da rodada sobre a nota: nova = (2 × atual + recebida) / 3.
// Mudar a inércia da nota é mudar estes dois números e rodar o replay.
export const PESO_RODADA_NUM = 1;
export const PESO_RODADA_DEN = 3;

/**
 * O multiplicador de um jogador numa rodada, como fração exata.
 *
 * Fração, e não `1.5`: o cálculo inteiro desta casa é aritmética de inteiros com
 * UM arredondamento no fim, e um float no meio traria de volta exatamente a
 * ambiguidade que o comentário de `arredondar` existe para afastar.
 */
export type FatorDaRodada = { num: number; den: number };

/** Sem multiplicador. A identidade da fórmula abaixo. */
export const FATOR_NEUTRO: FatorDaRodada = { num: 1, den: 1 };

const UM_DECIMO_EM_CENT = 10;

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

/**
 * Destrava os extremos da escala.
 *
 * Arredondando para uma casa, a média ponderada trava antes do extremo: com 5★
 * unânime a nota empaca em 9,9, porque (2 × 9,9 + 10,0) / 3 = 9,93 arredonda de
 * volta para 9,9. Espelhado, 1★ unânime empaca em 1,1. Sem isto, 10,0 e 1,0
 * existiriam na escala mas seriam inalcançáveis.
 *
 * A regra é genérica de propósito — "o resultado empatou e a média recebida está
 * no extremo" — em vez de um caso especial de 9,9. As duas formas são
 * equivalentes com o peso atual (9,9 é a única nota que trava com média 10,0),
 * mas a genérica continua valendo se PESO_RODADA mudar.
 *
 * O extremo não gruda: a partir de 10,0, um único 4★ no meio dos 5★ (média 9,55)
 * já devolve a nota para 9,9 na rodada seguinte.
 */
function destravarExtremo(novaCent: number, atualCent: number, mediaCent: number): number {
  if (novaCent !== atualCent) return novaCent;
  if (mediaCent === SKILL_MAX_CENT && atualCent < SKILL_MAX_CENT) {
    return atualCent + UM_DECIMO_EM_CENT;
  }
  if (mediaCent === SKILL_MIN_CENT && atualCent > SKILL_MIN_CENT) {
    return atualCent - UM_DECIMO_EM_CENT;
  }
  return novaCent;
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
  /** Meias-estrelas inteiras (1..10) — 7 = 3,5★. */
  halfStars: number;
};

export type RoundInput = {
  roundId: number;
  matchDayId: number;
  /** "YYYY-MM-DD" — a data do fut, que é o que ordena o replay. */
  matchDayDate: string;
  /** Rodada apurada antes da meia estrela: converte pela tabela congelada
   *  e só aceita meias pares (as estrelas inteiras da época, dobradas). */
  legacyScale: boolean;
  /** Só as avaliações válidas. Filtrar as descartadas é do chamador. */
  ratings: RatingInput[];
  /**
   * Quem armou multiplicador NESTE fut, e com que fator.
   *
   * Entra como fato durável (tabela `zenha_multiplicadores`) e não como estado
   * calculado: o replay roda inteiro a cada denúncia aceita e a cada fut
   * apagado, e reproduzir a nota exige reproduzir também o multiplicador que
   * valia na época. O fator é congelado na compra pelo mesmo motivo — se a loja
   * um dia vender 2×, a rodada antiga continua replaiando a 1,5×.
   *
   * Ausente é o caso normal: rodada sem ninguém multiplicado.
   */
  multiplicadores?: ReadonlyMap<number, FatorDaRodada>;
};

export type SkillChange = {
  playerId: number;
  roundId: number;
  /** Nota antes e depois, já na escala 1–10 com uma casa. */
  before: number;
  after: number;
  ratingsCount: number;
  averageReceived: number;
  /**
   * A nota desta rodada andou multiplicada.
   *
   * Vai para `skill_history` e aparece no histórico do jogador. Multiplicador é
   * a única coisa no sistema que faz a nota — o número que diz o que os
   * companheiros acharam — se mover mais rápido por dinheiro. Deixar isso sem
   * marca seria pior que a regra: quando alguém notasse, a descoberta é que
   * seria o problema.
   */
  multiplicado: boolean;
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
 * Ordem canônica das rodadas: data do fut, depois id do fut, depois id da
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

// O banco já barra os três primeiros casos (check de half_stars, check de
// rater <> rated, unique do par). Falhar alto aqui é o que denuncia dado
// corrompido em vez de deixá-lo virar nota silenciosamente errada. A paridade
// em rodada legada é só daqui: o banco não sabe a régua de cada rodada.
function validar(round: RoundInput): void {
  // A trava do multiplicador. Acima deste teto o coeficiente de `atual` na
  // fórmula fica NEGATIVO, o dividendo do `arredondar` pode ficar negativo, e
  // ele é meio-para-cima — a conta deixaria de ser simétrica sem que nada
  // acusasse. Na prática o limite é fator ≤ 3 com o peso atual, e a loja só
  // vende 1,25×, 1,5× e 2×; falhar alto aqui é o que garante que continue
  // assim mesmo se alguém gravar outra coisa no banco.
  for (const [playerId, fator] of round.multiplicadores ?? []) {
    if (!Number.isInteger(fator.num) || !Number.isInteger(fator.den) || fator.den <= 0) {
      throw new Error(
        `Rodada ${round.roundId}: fator inválido para o jogador ${playerId} ` +
          `(${fator.num}/${fator.den})`,
      );
    }
    if (fator.num * PESO_RODADA_NUM > fator.den * PESO_RODADA_DEN) {
      throw new Error(
        `Rodada ${round.roundId}: fator ${fator.num}/${fator.den} passa do teto ` +
          `(${PESO_RODADA_DEN}/${PESO_RODADA_NUM}) e inverteria o peso da nota atual`,
      );
    }
  }

  const vistos = new Set<string>();
  for (const r of round.ratings) {
    if (!Number.isInteger(r.halfStars) || r.halfStars < MEIAS_MIN || r.halfStars > MEIAS_MAX) {
      throw new Error(`Rodada ${round.roundId}: meias-estrelas inválidas (${r.halfStars})`);
    }
    if (round.legacyScale && r.halfStars % 2 !== 0) {
      throw new Error(
        `Rodada ${round.roundId}: meia estrela (${r.halfStars}) em rodada legada`,
      );
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
      acc.somaCent += round.legacyScale
        ? LEGADO_EM_CENTESIMOS[r.halfStars / 2]!
        : r.halfStars * CENTESIMOS;
      acc.total += 1;
      recebidas.set(r.ratedPlayerId, acc);
    }

    // Ordenar por playerId mantém o histórico estável entre execuções.
    const avaliados = [...recebidas.keys()].sort((a, b) => a - b);
    for (const playerId of avaliados) {
      const { somaCent, total } = recebidas.get(playerId)!;
      const atualCent = notaCent.get(playerId) ?? SKILL_INICIAL_CENT;
      const mediaCent = arredondar(somaCent, total);
      const fator = round.multiplicadores?.get(playerId) ?? FATOR_NEUTRO;

      // nova = atual + fator × (média − atual) × PESO_RODADA, arredondada direto
      // para décimos — um arredondamento só, na casa que a nota realmente tem.
      //
      // Escrita como PESO, e não como delta escalado depois do cálculo. A
      // diferença não é estética: `arredondar` é meio-para-CIMA e só recebe
      // dividendo positivo aqui. Escalar `(nova − atual)` depois exigiria
      // arredondar um número negativo quando a nota cai, e meio-para-cima sobre
      // negativo é assimétrico — quem cai cairia sistematicamente menos que
      // quem sobe pela mesma distância. Nesta forma o coeficiente de `atual` é
      // (den × 3 − num × 1), positivo para todo fator que `validar` aceita, e o
      // dividendo inteiro nunca fica negativo.
      //
      // Com o fator neutro isto se reduz LITERALMENTE à expressão de sempre,
      // `arredondar(2 × atual + média, 30)` — o refactor é inerte, e é por isso
      // que os casos antigos de skill.test.ts continuam valendo sem edição.
      const decimos = arredondar(
        (fator.den * PESO_RODADA_DEN - fator.num * PESO_RODADA_NUM) * atualCent +
          fator.num * PESO_RODADA_NUM * mediaCent,
        fator.den * PESO_RODADA_DEN * UM_DECIMO_EM_CENT,
      );
      // `destravarExtremo` e `clamp` ficam exatamente onde estavam, e NÃO são
      // multiplicados: o empurrão de 0,1 é mecanismo de alcançabilidade do topo
      // e do fundo da escala, não movimento da rodada.
      const novaCent = clamp(
        destravarExtremo(decimos * UM_DECIMO_EM_CENT, atualCent, mediaCent),
      );

      notaCent.set(playerId, novaCent);
      history.push({
        playerId,
        roundId: round.roundId,
        before: centParaNota(atualCent),
        after: centParaNota(novaCent),
        ratingsCount: total,
        averageReceived: centParaNota(mediaCent),
        // Por VALOR, não por identidade: o fator que vem do banco é um objeto
        // novo a cada leitura, e comparar com o singleton neutro marcaria como
        // multiplicada uma rodada que não andou nada. Fração é neutra quando
        // numerador e denominador são iguais.
        multiplicado: fator.num !== fator.den,
      });
    }
  }

  const skillByPlayer = new Map<number, number>();
  for (const [playerId, cent] of notaCent) skillByPlayer.set(playerId, centParaNota(cent));
  return { skillByPlayer, history };
}

export type NotaDoJogador = { id: number; skill: number };
export type MudancaDeNota = { id: number; antes: number; depois: number };

/**
 * Quem teve a nota alterada por um replay — quem recebe UPDATE e notificação.
 *
 * A regra que não é óbvia: **quem não aparece em `skillByPlayer` voltou para
 * 5,0**, não "ficou como estava". Sumir do replay é exatamente o que acontece
 * quando o único fut em que o jogador foi avaliado é apagado pelo grupo, ou
 * quando todas as notas que ele recebeu são descartadas por denúncia aceita.
 * Nesses casos a nota tem que desandar junto: deixá-la parada guardaria um
 * valor calculado a partir de avaliação que não existe mais, e é justamente
 * isso que a promessa de "recalcular sempre do zero" existe para evitar.
 *
 * Compara em centésimos para ruído de ponto flutuante não virar UPDATE e um
 * "sua nota mudou" sem mudança nenhuma.
 */
export function diffNotas(
  atuais: NotaDoJogador[],
  skillByPlayer: Map<number, number>,
): MudancaDeNota[] {
  const inicial = centParaNota(SKILL_INICIAL_CENT);
  return atuais
    .map((p) => ({ id: p.id, antes: p.skill, depois: skillByPlayer.get(p.id) ?? inicial }))
    .filter((m) => notaParaCent(m.antes) !== notaParaCent(m.depois));
}
