import { describe, expect, it } from "vitest";
import { SKILL_MAX_CENT, SKILL_MIN_CENT } from "./skill";
import {
  AJUSTES,
  AJUSTES_PADRAO,
  CHAVES_DE_AJUSTE,
  PERCENTUAIS_DO_MULTIPLICADOR,
  ZENHA_DESDE,
  avaliacaoCumprida,
  comSobrescritas,
  creditosDoFut,
  ehChaveDeAjuste,
  fatorDoPercentual,
  fechouSequencia,
  futPaga,
  presencasSeguidas,
  precoDoMultiplicador,
  validarValorDeAjuste,
  zenhaDaNota,
  zenhaDoMvp,
  type Ajustes,
  type FatosDoFut,
  type FatosDoJogador,
} from "./zenha";

// ── Helpers ─────────────────────────────────────────────────────────────────
//
// Os fatos são objetos largos e quase todo teste se importa com dois campos.
// As fábricas abaixo dão o "caminho feliz" e cada `it` sobrescreve só o que
// está sendo posto à prova — o que faz a intenção do caso ficar visível na
// própria chamada, em vez de escondida num literal de dez linhas.

/** Datas relativas à estreia da economia, para o teste não fossilizar a constante. */
function diaRelativo(iso: string, dias: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

const DEPOIS_DA_ESTREIA = diaRelativo(ZENHA_DESDE, 4);
const VESPERA_DA_ESTREIA = diaRelativo(ZENHA_DESDE, -1);

const ajustes = (sobre: Partial<Ajustes> = {}): Ajustes => ({ ...AJUSTES_PADRAO, ...sobre });

function jogador(sobre: Partial<FatosDoJogador> = {}): FatosDoJogador {
  return {
    playerId: 1,
    jogou: true,
    eraRater: true,
    enviouAvaliacao: true,
    votouMvp: true,
    notaAntesCent: null,
    notaDepoisCent: null,
    vencedoresDoMvp: 0,
    fechouStreak: false,
    futsPagosNaSemana: 0,
    ...sobre,
  };
}

const DESCRICAO = "fut de 05/09, na Quadra do Zé";

function fut(sobre: Partial<FatosDoFut> = {}): FatosDoFut {
  return {
    matchDayId: 7,
    roundId: 70,
    data: DEPOIS_DA_ESTREIA,
    ehDeGrupo: true,
    contasEmCampo: 10,
    haviaCandidatoMvp: true,
    descricaoDoFut: DESCRICAO,
    jogadores: [jogador()],
    ...sobre,
  };
}

// ────────────────────────────────────────────────────────────────────────────

describe("avaliacaoCumprida", () => {
  // O caso normal: o sistema convocou, a pessoa entregou tudo.
  it("rater que enviou a avaliação e votou no melhor em campo cumpriu", () => {
    expect(
      avaliacaoCumprida({ eraRater: true, enviouAvaliacao: true, votouMvp: true }, true),
    ).toBe(true);
  });

  // Enviar as estrelas e pular o voto é justamente o atalho que a participação
  // existe para desestimular — havendo em quem votar, não cumpriu.
  it("rater que enviou mas não votou, havendo candidato, não cumpriu", () => {
    expect(
      avaliacaoCumprida({ eraRater: true, enviouAvaliacao: true, votouMvp: false }, true),
    ).toBe(false);
  });

  // Sem candidato, a action grava `mvp_player_id = null` legitimamente: cobrar
  // o voto aqui seria cobrar por uma porta trancada — e a pessoa perderia a
  // participação por um fato que não estava na mão dela.
  it("rater que enviou e não votou por não haver candidato cumpriu", () => {
    expect(
      avaliacaoCumprida({ eraRater: true, enviouAvaliacao: true, votouMvp: false }, false),
    ).toBe(true);
  });

  // Não enviar reprova mesmo sem candidato ao título: o voto é o extra, as
  // estrelas são o ritual.
  it("rater que não enviou não cumpriu, com ou sem candidato", () => {
    expect(
      avaliacaoCumprida({ eraRater: true, enviouAvaliacao: false, votouMvp: false }, true),
    ).toBe(false);
    expect(
      avaliacaoCumprida({ eraRater: true, enviouAvaliacao: false, votouMvp: false }, false),
    ).toBe(false);
  });

  // Quem o sistema não convocou passa direto: fut sem rodada de avaliação e
  // lado pequeno demais para avaliar (lineup.ts) são os dois casos reais, e nos
  // dois a pessoa jogou sem ter o que enviar.
  it("quem não era rater cumpriu mesmo sem enviar nem votar", () => {
    expect(
      avaliacaoCumprida({ eraRater: false, enviouAvaliacao: false, votouMvp: false }, true),
    ).toBe(true);
  });
});

describe("zenhaDaNota", () => {
  // Ninguém o avaliou: não há linha em skill_history, e não há movimento a pagar.
  it("sem histórico de nota, não rende nada", () => {
    expect(zenhaDaNota(null, null, ajustes())).toBe(0);
  });

  // Meio nulo é dado impossível pelo contrato (os dois vêm da mesma linha de
  // skill_history), mas a guarda tem que ser `||` e não `&&`: com `&&`, um
  // `antes` nulo cairia na subtração e `depois - null` renderia a nota INTEIRA
  // como se ela tivesse subido de zero — 10,0 valendo cem décimos de uma vez.
  it("com apenas um dos lados nulo, não rende nada", () => {
    expect(zenhaDaNota(null, 550, ajustes())).toBe(0);
    expect(zenhaDaNota(550, null, ajustes())).toBe(0);
  });

  it("subir um décimo paga uma vez o valor por décimo", () => {
    expect(zenhaDaNota(500, 510, ajustes())).toBe(AJUSTES.nota_por_decimo.padrao);
  });

  // É a proporcionalidade que faz o multiplicador ter sentido econômico sem
  // uma linha a mais: ele amplia o movimento em skill.ts e o ganho vem junto.
  it("subir cinco décimos paga cinco vezes", () => {
    expect(zenhaDaNota(500, 550, ajustes())).toBe(5 * AJUSTES.nota_por_decimo.padrao);
  });

  // Não existe PERDA: cair rende zero, nunca negativo.
  it("nota que caiu rende zero, não desconto", () => {
    expect(zenhaDaNota(600, 570, ajustes())).toBe(0);
  });

  it("nota parada fora do teto rende zero", () => {
    expect(zenhaDaNota(730, 730, ajustes())).toBe(0);
  });

  // O único empate que paga, porque é o único de onde não há para onde subir —
  // e manter 10,0 exige avaliação praticamente unânime.
  it("nota parada em 10,0 paga o prêmio de manter no teto", () => {
    expect(zenhaDaNota(SKILL_MAX_CENT, SKILL_MAX_CENT, ajustes())).toBe(
      AJUSTES.manter_no_teto.padrao,
    );
  });

  // O piso não é o teto: parar em 1,0 não é conquista nenhuma.
  it("nota parada em 1,0 rende zero", () => {
    expect(zenhaDaNota(SKILL_MIN_CENT, SKILL_MIN_CENT, ajustes())).toBe(0);
  });

  it("respeita a sobrescrita do valor por décimo", () => {
    expect(zenhaDaNota(500, 530, ajustes({ nota_por_decimo: 7 }))).toBe(21);
  });
});

describe("zenhaDoMvp", () => {
  it("quem não é um dos vencedores não recebe", () => {
    expect(zenhaDoMvp(0, ajustes())).toBe(0);
  });

  it("vencedor único leva o valor cheio", () => {
    expect(zenhaDoMvp(1, ajustes())).toBe(AJUSTES.mvp.padrao);
  });

  // Pagar o cheio a cada empatado transformaria o empate na melhor coisa que
  // pode acontecer com o grupo.
  it("três empatados dividem por três", () => {
    expect(zenhaDoMvp(3, ajustes())).toBe(50);
  });

  // 150 ÷ 4 = 37,5 — a divisão TRUNCA, e a sobra some. Zenha é inteira: o
  // resto não tem para onde ir, e distribuí-lo daria um vencedor mais premiado
  // que o outro no mesmo título.
  it("divisão inexata trunca para baixo", () => {
    expect(zenhaDoMvp(4, ajustes())).toBe(37);
  });

  // Sem o piso, um prêmio pequeno com muitos empatados viraria uma linha de
  // zero zenha no extrato — o título aparece e não paga nada.
  it("piso de 1 quando a divisão daria menos que uma zenha", () => {
    expect(zenhaDoMvp(5, ajustes({ mvp: 2 }))).toBe(1);
  });

  // O contraponto do piso acima, e a razão de a guarda de zero vir ANTES dele.
  // Todo ajuste de pagamento tem min 0, e zero é como o admin desliga uma fonte
  // no painel — participacao e streak_premio se desligam assim em
  // creditosDoFut, e a fonte "nota" também, por multiplicação. O mvp precisou
  // da guarda explícita: `Math.max(1, Math.floor(0 / 3))` é 1, então sem ela
  // desligar o prêmio continuaria pagando uma zenha a cada vencedor, para
  // sempre — e num ledger append-only com unique(player_id, dedupe_key) isso
  // não se desfaz nem se repaga.
  it("prêmio ajustado para zero desliga a fonte em vez de pagar o piso", () => {
    expect(zenhaDoMvp(1, ajustes({ mvp: 0 }))).toBe(0);
    expect(zenhaDoMvp(3, ajustes({ mvp: 0 }))).toBe(0);
  });
});

describe("futPaga", () => {
  it("fut de grupo, depois da estreia e com gente em campo paga", () => {
    expect(futPaga(fut(), ajustes())).toBe(true);
  });

  // Fut avulso não tem grupo para dar contexto a streak, a teto semanal nem a
  // nada — e é o mais fácil de fabricar.
  it("fut avulso não paga", () => {
    expect(futPaga(fut({ ehDeGrupo: false }), ajustes())).toBe(false);
  });

  // A trava do passado: sem ela a primeira varredura liquidaria o histórico
  // inteiro de uma vez.
  it("fut anterior à estreia da economia não paga", () => {
    expect(futPaga(fut({ data: VESPERA_DA_ESTREIA }), ajustes())).toBe(false);
  });

  // A borda é inclusiva: o fut do próprio dia da estreia já é da economia nova.
  it("fut no dia exato da estreia paga", () => {
    expect(futPaga(fut({ data: ZENHA_DESDE }), ajustes())).toBe(true);
  });

  // O freio de fabricação de fantasmas: comparação é >=, então o mínimo em
  // ponto passa e um a menos não. Errar o sinal aqui é o tipo de bug que só
  // aparece no fut de sábado com um a menos.
  it("a borda do mínimo de contas em campo é inclusiva", () => {
    const min = AJUSTES.min_contas_para_pagar.padrao;
    expect(futPaga(fut({ contasEmCampo: min }), ajustes())).toBe(true);
    expect(futPaga(fut({ contasEmCampo: min - 1 }), ajustes())).toBe(false);
  });

  // De graça, o piso faz fut sem jogo lançado (ninguém em campo) não pagar.
  it("fut sem ninguém em campo não paga", () => {
    expect(futPaga(fut({ contasEmCampo: 0 }), ajustes())).toBe(false);
  });

  it("o mínimo é o vigente, não o padrão", () => {
    expect(futPaga(fut({ contasEmCampo: 3 }), ajustes({ min_contas_para_pagar: 3 }))).toBe(true);
  });
});

describe("creditosDoFut", () => {
  it("fut que não paga não gera linha nenhuma", () => {
    expect(creditosDoFut(fut({ ehDeGrupo: false }), ajustes())).toEqual([]);
    expect(creditosDoFut(fut({ data: VESPERA_DA_ESTREIA }), ajustes())).toEqual([]);
    expect(creditosDoFut(fut({ contasEmCampo: 1 }), ajustes())).toEqual([]);
  });

  // A presença que conta é a escalação (game_players), não o "Vou" da lista:
  // um é o registro de quem jogou, o outro é uma intenção.
  it("quem confirmou mas não entrou em campo não recebe nada", () => {
    const linhas = creditosDoFut(
      fut({
        jogadores: [
          jogador({ playerId: 1, jogou: false, notaAntesCent: 500, notaDepoisCent: 550 }),
        ],
      }),
      ajustes(),
    );
    expect(linhas).toEqual([]);
  });

  // ESTE É O CASO QUE O MOTOR EXISTE PARA GARANTIR: não há PORTÃO. Nota que
  // caiu simplesmente não rende a fonte "nota" — não zera participação, mvp
  // nem streak. Todo mundo começa em 5,0, e qualquer piso castigaria o novato
  // semana após semana.
  it("nota que caiu não bloqueia participação, mvp nem streak", () => {
    const linhas = creditosDoFut(
      fut({
        jogadores: [
          jogador({
            playerId: 1,
            notaAntesCent: 640,
            notaDepoisCent: 590,
            vencedoresDoMvp: 1,
            fechouStreak: true,
          }),
        ],
      }),
      ajustes(),
    );
    expect(linhas.map((l) => l.motivo)).toEqual(["participacao", "mvp", "streak"]);
    expect(linhas.map((l) => l.amount)).toEqual([100, 150, 250]);
  });

  // As quatro fontes de uma vez, com as chaves exatas: elas são o contrato de
  // idempotência com o unique(player_id, dedupe_key) do ledger, e mudar o
  // formato aqui faz a varredura pagar duas vezes o mesmo fut.
  it("jogador que cumpriu tudo gera as quatro linhas com as chaves do fut", () => {
    const linhas = creditosDoFut(
      fut({
        jogadores: [
          jogador({
            playerId: 42,
            notaAntesCent: 500,
            notaDepoisCent: 530,
            vencedoresDoMvp: 1,
            fechouStreak: true,
          }),
        ],
      }),
      ajustes(),
    );

    expect(linhas).toEqual([
      {
        playerId: 42,
        matchDayId: 7,
        roundId: 70,
        motivo: "participacao",
        amount: 100,
        dedupeKey: "participacao:fut:7",
        descricao: `Participação no ${DESCRICAO}`,
      },
      {
        playerId: 42,
        matchDayId: 7,
        roundId: 70,
        motivo: "nota",
        amount: 120,
        dedupeKey: "nota:fut:7",
        descricao: `Sua nota subiu 0,3 no ${DESCRICAO}`,
      },
      {
        playerId: 42,
        matchDayId: 7,
        roundId: 70,
        motivo: "mvp",
        amount: 150,
        dedupeKey: "mvp:fut:7",
        descricao: `Melhor em campo no ${DESCRICAO}`,
      },
      {
        playerId: 42,
        matchDayId: 7,
        roundId: 70,
        motivo: "streak",
        amount: 250,
        dedupeKey: "streak:fut:7",
        descricao: "5 futs seguidos no grupo",
      },
    ]);
  });

  // A descrição é congelada no extrato — ela é lida meses depois, quando a
  // pessoa não lembra de que fut se trata. Daí citar o fut por extenso em vez
  // de guardar só o id.
  it("as descrições saem em português e citam o fut", () => {
    const linhas = creditosDoFut(
      fut({
        jogadores: [
          jogador({
            notaAntesCent: SKILL_MAX_CENT,
            notaDepoisCent: SKILL_MAX_CENT,
            vencedoresDoMvp: 2,
          }),
        ],
      }),
      ajustes(),
    );
    expect(linhas.map((l) => l.descricao)).toEqual([
      `Participação no ${DESCRICAO}`,
      `Nota mantida em 10,0 no ${DESCRICAO}`,
      `Melhor em campo (título dividido) no ${DESCRICAO}`,
    ]);
  });

  // O teto semanal é o freio de quem joga em três grupos no mesmo sábado: o
  // fut acontece normalmente, só não paga. A comparação é >=, então quem já
  // teve `max` futs pagos está fora e quem teve um a menos ainda entra.
  it("a borda do teto de futs pagos na semana corta o jogador inteiro", () => {
    const max = AJUSTES.max_futs_pagos_semana.padrao;
    const comTeto = (futsPagosNaSemana: number) =>
      creditosDoFut(
        fut({
          jogadores: [
            jogador({
              futsPagosNaSemana,
              notaAntesCent: 500,
              notaDepoisCent: 550,
              vencedoresDoMvp: 1,
              fechouStreak: true,
            }),
          ],
        }),
        ajustes(),
      );

    expect(comTeto(max - 1)).toHaveLength(4);
    // Nem participação sobra: o corte é do jogador, não de uma fonte.
    expect(comTeto(max)).toEqual([]);
    expect(comTeto(max + 5)).toEqual([]);
  });

  // Quem não cumpriu o ritual perde a participação e SÓ ela — as outras fontes
  // continuam de pé, porque elas não dependem de ele ter avaliado ninguém.
  it("quem não cumpriu a avaliação perde a participação, mas não o resto", () => {
    const linhas = creditosDoFut(
      fut({
        jogadores: [
          jogador({
            votouMvp: false,
            notaAntesCent: 500,
            notaDepoisCent: 510,
            vencedoresDoMvp: 1,
          }),
        ],
      }),
      ajustes(),
    );
    expect(linhas.map((l) => l.motivo)).toEqual(["nota", "mvp"]);
  });

  // O `haviaCandidatoMvp` é do FUT e o `votouMvp` é do jogador: creditosDoFut
  // tem que repassar um ao outro. Sem este caso, trocar a chamada por
  // `avaliacaoCumprida(j, true)` passaria despercebido — e todo mundo de um fut
  // sem candidato ao título perderia a participação por uma porta trancada.
  it("sem candidato ao título, quem não votou ainda leva a participação", () => {
    const linhas = creditosDoFut(
      fut({
        haviaCandidatoMvp: false,
        jogadores: [jogador({ votouMvp: false })],
      }),
      ajustes(),
    );
    expect(linhas.map((l) => l.motivo)).toEqual(["participacao"]);
  });

  // Ajuste zerado é como o admin DESLIGA a fonte: nenhuma linha de zero zenha
  // deve aparecer no extrato de ninguém.
  it("fonte com valor zero não vira linha de zero no extrato", () => {
    const linhas = creditosDoFut(
      fut({ jogadores: [jogador({ fechouStreak: true })] }),
      ajustes({ participacao: 0, streak_premio: 0 }),
    );
    expect(linhas).toEqual([]);
  });

  // As duas metades da fonte "nota" desligam pela multiplicação e pelo próprio
  // valor — o teto e a subida têm ajustes separados, e zerar um não pode
  // apagar o outro.
  it("as duas metades da fonte nota desligam em separado", () => {
    const queSubiu = jogador({ playerId: 1, notaAntesCent: 500, notaDepoisCent: 550 });
    const noTeto = jogador({
      playerId: 2,
      notaAntesCent: SKILL_MAX_CENT,
      notaDepoisCent: SKILL_MAX_CENT,
    });
    const semSubida = creditosDoFut(
      fut({ jogadores: [queSubiu, noTeto] }),
      ajustes({ participacao: 0, nota_por_decimo: 0 }),
    );
    expect(semSubida.map((l) => `${l.playerId}:${l.motivo}`)).toEqual(["2:nota"]);

    const semTeto = creditosDoFut(
      fut({ jogadores: [queSubiu, noTeto] }),
      ajustes({ participacao: 0, manter_no_teto: 0 }),
    );
    expect(semTeto.map((l) => `${l.playerId}:${l.motivo}`)).toEqual(["1:nota"]);
  });

  // As chaves são por FUT e não por jogador: a idempotência mora no unique
  // (player_id, dedupe_key) do ledger, então a mesma chave em jogadores
  // diferentes é o esperado — e é o que permite pagar fut encerrado sem rodada
  // nenhuma, onde não existe roundId para compor a chave.
  it("a chave de dedupe se repete entre jogadores do mesmo fut", () => {
    const linhas = creditosDoFut(
      fut({
        matchDayId: 31,
        jogadores: [jogador({ playerId: 1 }), jogador({ playerId: 2 })],
      }),
      ajustes(),
    );
    expect(linhas.map((l) => [l.playerId, l.dedupeKey])).toEqual([
      [1, "participacao:fut:31"],
      [2, "participacao:fut:31"],
    ]);
  });

  it("preserva a ordem dos jogadores recebidos", () => {
    const linhas = creditosDoFut(
      fut({
        jogadores: [
          jogador({ playerId: 9, fechouStreak: true }),
          jogador({ playerId: 3, vencedoresDoMvp: 1 }),
        ],
      }),
      ajustes(),
    );
    expect(linhas.map((l) => `${l.playerId}:${l.motivo}`)).toEqual([
      "9:participacao",
      "9:streak",
      "3:participacao",
      "3:mvp",
    ]);
  });

  // Nenhuma fonte é negativa — a única linha negativa do ledger é a compra, e
  // ela não passa por aqui.
  it("todo crédito é positivo", () => {
    const linhas = creditosDoFut(
      fut({
        jogadores: [
          jogador({ playerId: 1, notaAntesCent: 500, notaDepoisCent: 900, vencedoresDoMvp: 9 }),
          jogador({ playerId: 2, notaAntesCent: 900, notaDepoisCent: 500, fechouStreak: true }),
        ],
      }),
      ajustes(),
    );
    expect(linhas.length).toBeGreaterThan(0);
    expect(linhas.every((l) => l.amount > 0)).toBe(true);
  });
});

describe("ajustes e validação", () => {
  it("todo ajuste declarado tem padrão vigente", () => {
    expect(Object.keys(AJUSTES_PADRAO).sort()).toEqual([...CHAVES_DE_AJUSTE].sort());
    for (const chave of CHAVES_DE_AJUSTE) {
      expect(AJUSTES_PADRAO[chave]).toBe(AJUSTES[chave].padrao);
    }
  });

  // O padrão de fábrica não pode ser recusado pela própria validação — seria
  // uma economia que nasce inválida e que o admin não conseguiria restaurar.
  it("todo padrão passa na própria validação", () => {
    for (const chave of CHAVES_DE_AJUSTE) {
      expect(validarValorDeAjuste(chave, AJUSTES[chave].padrao)).toBeNull();
    }
  });

  // hasOwn e não `in`: sem ele, "toString" e "constructor" seriam ajustes
  // válidos vindos do Object.prototype, e comSobrescritas gravaria lixo.
  it("chave herdada do prototype não é ajuste", () => {
    expect(ehChaveDeAjuste("participacao")).toBe(true);
    expect(ehChaveDeAjuste("toString")).toBe(false);
    expect(ehChaveDeAjuste("constructor")).toBe(false);
    expect(ehChaveDeAjuste("preco:multiplicador")).toBe(false);
  });

  it("recusa chave desconhecida", () => {
    expect(validarValorDeAjuste("nao_existe", 10)).toBe("Esse ajuste não existe.");
  });

  // Zenha é inteira em todo o sistema; um ajuste fracionário viraria centavo
  // de zenha no extrato.
  it("recusa valor não inteiro", () => {
    expect(validarValorDeAjuste("participacao", 10.5)).toBe("Use um número inteiro.");
    expect(validarValorDeAjuste("participacao", Number.NaN)).toBe("Use um número inteiro.");
  });

  it("recusa abaixo do mínimo e acima do máximo, e aceita as bordas", () => {
    const { min, max } = AJUSTES.streak_tamanho;
    expect(validarValorDeAjuste("streak_tamanho", min - 1)).toBe(`Use um número de ${min} a ${max}.`);
    expect(validarValorDeAjuste("streak_tamanho", max + 1)).toBe(`Use um número de ${min} a ${max}.`);
    expect(validarValorDeAjuste("streak_tamanho", min)).toBeNull();
    expect(validarValorDeAjuste("streak_tamanho", max)).toBeNull();
  });

  // O fator vira fração exata dentro do cálculo da nota: um percentual fora da
  // lista é o ponto flutuante entrando no único lugar onde ele não pode. Note
  // que 130 está DENTRO de min/max e mesmo assim é recusado — quando existe
  // `valores`, a faixa não é consultada.
  it("o fator do multiplicador só aceita os percentuais da lista", () => {
    expect(validarValorDeAjuste("multiplicador_fator", 130)).toBe("Valores aceitos: 125, 150, 200.");
    expect(validarValorDeAjuste("multiplicador_fator", 150)).toBeNull();
    for (const p of PERCENTUAIS_DO_MULTIPLICADOR) {
      expect(validarValorDeAjuste("multiplicador_fator", p)).toBeNull();
    }
  });
});

describe("comSobrescritas", () => {
  it("sem sobrescrita nenhuma, vale o padrão", () => {
    expect(comSobrescritas(new Map())).toEqual(AJUSTES_PADRAO);
  });

  it("aplica a sobrescrita válida por cima do padrão", () => {
    const vigentes = comSobrescritas(new Map([["participacao", 250]]));
    expect(vigentes.participacao).toBe(250);
    expect(vigentes.mvp).toBe(AJUSTES.mvp.padrao);
  });

  // O ponto todo da função: valor gravado por uma versão em que a faixa era
  // outra volta ao padrão em vez de derrubar a leitura. Uma economia que para
  // de funcionar é pior que uma que volta ao padrão.
  it("ignora sobrescrita inválida em vez de derrubar a economia", () => {
    const vigentes = comSobrescritas(
      new Map([
        ["participacao", 999_999], // acima do max
        ["streak_tamanho", 1.5], // fracionário
        ["multiplicador_fator", 130], // fora da lista de valores
        ["nao_existe", 10], // chave morta
        ["preco:multiplicador", 300], // chave da loja, não da economia
        ["mvp", 200], // esta é válida e deve passar
      ]),
    );
    expect(vigentes.participacao).toBe(AJUSTES.participacao.padrao);
    expect(vigentes.streak_tamanho).toBe(AJUSTES.streak_tamanho.padrao);
    expect(vigentes.multiplicador_fator).toBe(AJUSTES.multiplicador_fator.padrao);
    expect(vigentes.mvp).toBe(200);
    expect(Object.keys(vigentes).sort()).toEqual([...CHAVES_DE_AJUSTE].sort());
  });

  it("não contamina os padrões entre duas leituras", () => {
    comSobrescritas(new Map([["participacao", 1]]));
    expect(comSobrescritas(new Map()).participacao).toBe(AJUSTES.participacao.padrao);
    expect(AJUSTES_PADRAO.participacao).toBe(AJUSTES.participacao.padrao);
  });
});

describe("fatorDoPercentual", () => {
  it("os percentuais viram fração exata", () => {
    expect(fatorDoPercentual(125)).toEqual({ num: 5, den: 4 });
    expect(fatorDoPercentual(150)).toEqual({ num: 3, den: 2 });
    expect(fatorDoPercentual(200)).toEqual({ num: 2, den: 1 });
  });

  // A rede: se alguém acrescentar um percentual à lista sem acrescentar a
  // fração, o admin conseguiria gravar um fator que estoura na hora de aplicar
  // a nota — e estouraria em produção, no fechamento da rodada.
  it("todo percentual oferecido tem fração correspondente", () => {
    for (const p of PERCENTUAIS_DO_MULTIPLICADOR) {
      const f = fatorDoPercentual(p);
      expect(f.den).toBeGreaterThan(0);
      // A fração tem que valer o percentual anunciado, e não uma aproximação.
      expect((f.num * 100) / f.den).toBe(p);
    }
  });

  // Falha alto de propósito: o percentual vem de uma coluna congelada na
  // compra, e um valor fora da tabela quer dizer dado corrompido. Lançar aqui
  // é o que impede isso de virar nota silenciosamente errada.
  it("lança em percentual desconhecido", () => {
    expect(() => fatorDoPercentual(130)).toThrow(/desconhecido/);
    expect(() => fatorDoPercentual(0)).toThrow(/desconhecido/);
    expect(() => fatorDoPercentual(100)).toThrow(/desconhecido/);
  });
});

describe("precoDoMultiplicador", () => {
  // Com o preço-base padrão a escada dá números redondos por construção. Se um
  // degrau mudar, é aqui que se vê o preço que o jogador passa a ver.
  // 120 é o preço com que a migration 0033 semeia a linha do consumível — a
  // `base` deixou de ser ajuste da economia e virou `loja_itens.preco`.
  const BASE_SEMEADA = 120;

  it("a escada do preço-base padrão é 120, 160, 210 e 280", () => {
    expect([0, 1, 2, 3].map((n) => precoDoMultiplicador(BASE_SEMEADA, n))).toEqual([
      120, 160, 210, 280,
    ]);
  });

  // O último degrau se repete: a escada trava em vez de crescer sem fim, senão
  // o item viraria inalcançável para quem joga muito — e o teto é o que o
  // mantém uma aposta cara, não uma impossibilidade.
  it("da quarta compra em diante o preço trava no último degrau", () => {
    expect(precoDoMultiplicador(BASE_SEMEADA, 4)).toBe(280);
    expect(precoDoMultiplicador(BASE_SEMEADA, 12)).toBe(280);
  });

  // Contagem negativa é dado impossível, mas o clamp evita indexar fora da
  // escada e devolver NaN como preço de loja.
  it("contagem negativa cai no primeiro degrau", () => {
    expect(precoDoMultiplicador(120, -3)).toBe(120);
  });

  // Preço com terminação quebrada ("213 zenhas") parece erro de conta, não
  // decisão — por isso todo degrau é arredondado para múltiplo de 5, inclusive
  // com uma base que o admin escolheu torta.
  it("todo degrau sai múltiplo de 5, mesmo com base quebrada", () => {
    const precos = [0, 1, 2, 3, 4].map((n) => precoDoMultiplicador(97, n));
    expect(precos).toEqual([95, 130, 170, 225, 225]);
    for (const p of precos) expect(p % 5).toBe(0);
  });

  it("base zero custa zero em todos os degraus", () => {
    expect([0, 1, 2, 3].map((n) => precoDoMultiplicador(0, n))).toEqual([0, 0, 0, 0]);
  });

  // A escada nunca barateia: recomprar no mesmo mês tem que doer mais.
  it("o preço é monótono não decrescente ao longo do mês", () => {
    const precos = [0, 1, 2, 3, 4, 5].map((n) => precoDoMultiplicador(345, n));
    for (let i = 1; i < precos.length; i++) {
      expect(precos[i]).toBeGreaterThanOrEqual(precos[i - 1]);
    }
  });
});

describe("presencasSeguidas", () => {
  // Os futs chegam em ordem de data, e o último é sempre o que está sendo
  // liquidado — a contagem anda de trás para frente a partir dele.
  const f = (presente: boolean, naEspera = false) => ({ matchDayId: 0, presente, naEspera });

  it("conta a corrida que termina no último fut", () => {
    expect(presencasSeguidas([f(true), f(true), f(true)])).toBe(3);
  });

  it("para na primeira falta, ignorando o que veio antes dela", () => {
    expect(presencasSeguidas([f(true), f(true), f(false), f(true), f(true)])).toBe(2);
  });

  // O caso que a decisão de produto pediu: quem quis ir e não coube não perde a
  // sequência. O fut some da contagem — não conta como presença nem como falta.
  it("a lista de espera atravessa a sequência sem contar nem quebrar", () => {
    expect(presencasSeguidas([f(true), f(true), f(false, true), f(true)])).toBe(3);
  });

  it("espera no fim não conta como presença", () => {
    expect(presencasSeguidas([f(true), f(true), f(false, true)])).toBe(2);
  });

  it("falta no último fut zera, mesmo com corrida longa atrás", () => {
    expect(presencasSeguidas([f(true), f(true), f(true), f(false)])).toBe(0);
  });

  it("lista vazia é zero", () => {
    expect(presencasSeguidas([])).toBe(0);
  });

  // Uma sequência inteira de espera não é presença nenhuma: sem esta rede, o
  // `else if (!naEspera) break` percorreria a lista toda e devolveria 0 — que é
  // o certo, mas por acidente. O teste trava o resultado.
  it("só espera é zero", () => {
    expect(presencasSeguidas([f(false, true), f(false, true)])).toBe(0);
  });
});

describe("fechouSequencia", () => {
  const a = AJUSTES_PADRAO;

  it("fecha no múltiplo do tamanho e em nenhum outro ponto", () => {
    for (const n of [5, 10, 15]) expect(fechouSequencia(n, a)).toBe(true);
    for (const n of [1, 4, 6, 9, 11]) expect(fechouSequencia(n, a)).toBe(false);
  });

  // Zero é múltiplo de tudo. Sem a guarda, quem faltou fecharia sequência.
  it("zero não fecha", () => {
    expect(fechouSequencia(0, a)).toBe(false);
  });

  it("segue o tamanho ajustado pelo admin", () => {
    const curto = { ...a, streak_tamanho: 3 };
    expect(fechouSequencia(3, curto)).toBe(true);
    expect(fechouSequencia(5, curto)).toBe(false);
  });

  // A liquidação pode acontecer fora de ordem — um fut segurado por denúncia é
  // pago depois de outro mais recente. Como a resposta sai da POSIÇÃO na
  // sequência, e não de um contador que zera, só uma das duas posições
  // consecutivas pode fechar: o prêmio não sai duas vezes nem deixa de sair.
  it("posições consecutivas nunca fecham as duas", () => {
    for (let n = 1; n < 30; n++) {
      expect(fechouSequencia(n, a) && fechouSequencia(n + 1, a)).toBe(false);
    }
  });
});
