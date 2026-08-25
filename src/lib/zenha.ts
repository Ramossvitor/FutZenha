// O motor da zenha. Puro de propósito — sem banco, sem `server-only` — para que
// a tabela de ganho e a divisão do MVP fiquem travadas por teste, e para que a
// página /guia possa importar os valores sem arrastar drizzle junto.
//
// Quem chama isto (src/lib/zenha-engine.ts) resolve os FATOS no banco e entrega
// um objeto; aqui só se decide quanto cada fato vale. É a mesma fronteira de
// skill.ts e mvp.ts, e pelo mesmo motivo: errar aqui é pagar a pessoa errada.
//
// ── As quatro fontes de GANHO, e só elas ───────────────────────────────────
//   participação — foi ao fut E cumpriu o ritual da avaliação. Um crédito só.
//   nota         — subiu no fechamento da rodada, proporcional ao quanto subiu.
//   mvp          — eleito o melhor em campo, dividido entre empatados.
//   streak       — fechou a sequência de presenças seguidas no grupo.
//
// Não existe PORTÃO: nota que caiu simplesmente não rende a fonte "nota", e não
// zera as outras. Todo jogador começa em 5,0, então qualquer regra de piso
// castigaria justamente o novato, semana após semana.
//
// Não existe PERDA: nenhuma fonte daqui é negativa e nada estorna. Só duas
// coisas debitam no sistema inteiro, e as duas exigem que a pessoa aperte um
// botão — a compra na loja e a aposta (src/lib/aposta.ts).
//
// Gol e vitória NÃO pagam, de propósito: placar e gols continuam editáveis por
// JANELA_CORRECAO_HORAS depois do encerramento, e pagar por eles seria pagar
// por fato ainda mutável. A aposta paga justamente por vitória, e é por isso
// que ela é a única coisa da economia que espera a janela de correção fechar
// antes de mover dinheiro.

import type { ZenhaMotivo } from "@/db/schema";
import { type FatorDaRodada, SKILL_MAX_CENT } from "./skill";

/**
 * Nada anterior a esta data paga.
 *
 * A economia começa a contar do primeiro fut depois do deploy. Sem a trava, a
 * primeira varredura liquidaria o histórico inteiro de uma vez — e quem joga
 * desde o começo compraria a loja toda no primeiro dia, enquanto quem chegou
 * depois nunca alcançaria.
 *
 * Diferente de tudo o que está abaixo, esta NÃO é ajustável pelo admin: mexer
 * nela é reabrir o passado, que é exatamente o que ela existe para fechar.
 *
 * Foi movida uma vez, de 2026-09-01 para cá, com o `zenha_ledger` ainda VAZIO —
 * a única janela em que corrigir a data não reabre nada, porque não havia
 * passado. Depois do primeiro crédito, essa janela fechou: antecipar a estreia
 * passaria a liquidar futs que já eram história, e o certo aí é não mexer.
 */
export const ZENHA_DESDE = "2026-08-22";

// ── Os ajustes ──────────────────────────────────────────────────────────────
//
// Todo valor da economia é editável pelo admin da plataforma. O que está aqui
// é o PADRÃO; a tabela zenha_config guarda só as sobrescritas, e chave ausente
// vale o padrão daqui.
//
// PREÇO não é ajuste da economia: ele é coluna de `loja_itens`, editada na tela
// da loja. O que sobra aqui é o que a economia PAGA — mais o fator do
// multiplicador, que é regra de jogo e não etiqueta de preço.
//
// Mudar um valor vale DALI PARA FRENTE. Nada é recalculado — o que já foi pago
// está no ledger, que é append-only. Não existe código de reprocessamento a
// escrever, e é essa ausência que torna o painel do admin seguro.

export type ChaveDeAjuste =
  | "participacao"
  | "nota_por_decimo"
  | "manter_no_teto"
  | "mvp"
  | "streak_premio"
  | "streak_tamanho"
  | "min_contas_para_pagar"
  | "max_futs_pagos_semana"
  | "multiplicador_fator"
  // Os três da aposta. Não pagam nada — governam quanto se pode arriscar e até
  // quando —, mas moram aqui porque é o painel de quem administra a economia.
  | "aposta_min"
  | "aposta_max"
  | "aposta_fecha_min_antes";

export type DefinicaoDeAjuste = {
  padrao: number;
  /** O nome do campo no painel do admin. */
  rotulo: string;
  /** O que o número faz, em uma frase — vira a ajuda embaixo do campo. */
  descricao: string;
  min: number;
  max: number;
  /**
   * Quando presente, só estes valores são aceitos e `min`/`max` não são
   * consultados. Existe para o fator do multiplicador: ele vira fração exata
   * dentro do cálculo da nota, e um percentual arbitrário abriria a porta do
   * ponto flutuante no único lugar do sistema onde ele não pode entrar.
   */
  valores?: readonly number[];
};

/** Os percentuais que o multiplicador aceita. 150 = 1,5×. */
export const PERCENTUAIS_DO_MULTIPLICADOR = [125, 150, 200] as const;

export const AJUSTES: Readonly<Record<ChaveDeAjuste, DefinicaoDeAjuste>> = {
  participacao: {
    padrao: 100,
    rotulo: "Participação",
    descricao:
      "Por ir ao fut e cumprir a avaliação (avaliar os companheiros e votar no melhor em campo). É a fonte que todo mundo controla sozinho.",
    min: 0,
    max: 1000,
  },
  nota_por_decimo: {
    padrao: 40,
    rotulo: "Por décimo de nota",
    descricao:
      "Multiplicado pelo quanto a nota subiu no fechamento das avaliações. Subir 0,3 paga o triplo de subir 0,1.",
    min: 0,
    max: 500,
  },
  manter_no_teto: {
    padrao: 80,
    rotulo: "Manter a nota em 10,0",
    descricao:
      "Quem já está no teto não tem para onde subir. Este é o valor que ele recebe por não cair — o que exige avaliação praticamente unânime.",
    min: 0,
    max: 1000,
  },
  mvp: {
    padrao: 150,
    rotulo: "Melhor em campo",
    descricao:
      "Dividido igualmente quando o título empata, com piso de 1 zenha para cada vencedor.",
    min: 0,
    max: 2000,
  },
  streak_premio: {
    padrao: 250,
    rotulo: "Prêmio da sequência",
    descricao: "Pago ao fechar a sequência de presenças seguidas. A contagem reinicia do zero.",
    min: 0,
    max: 2000,
  },
  streak_tamanho: {
    padrao: 5,
    rotulo: "Tamanho da sequência",
    descricao:
      "Quantos futs seguidos do grupo fecham o prêmio. Ficar na lista de espera não quebra a sequência; faltar tendo vaga quebra.",
    min: 2,
    max: 20,
  },
  min_contas_para_pagar: {
    padrao: 6,
    rotulo: "Mínimo de jogadores em campo",
    descricao:
      "Contas ativas distintas que precisam ter entrado em campo para o fut pagar alguma coisa. É o que torna caro fabricar fut de mentira.",
    min: 2,
    max: 20,
  },
  max_futs_pagos_semana: {
    padrao: 2,
    rotulo: "Máximo de futs pagos por semana",
    descricao: "Teto por jogador, por semana. Fut além do teto acontece normalmente, mas não paga.",
    min: 1,
    max: 7,
  },
  multiplicador_fator: {
    padrao: 150,
    rotulo: "Força do multiplicador (%)",
    descricao:
      "150 = 1,5×. Amplia o movimento da nota nos dois sentidos, e o ganho da nota vem junto por ser proporcional. Vale só para os multiplicadores comprados a partir da mudança.",
    min: 125,
    max: 200,
    valores: PERCENTUAIS_DO_MULTIPLICADOR,
  },
  aposta_min: {
    padrao: 10,
    rotulo: "Aposta mínima",
    descricao: "O menor valor aceito numa aposta.",
    min: 1,
    max: 1000,
  },
  aposta_max: {
    padrao: 500,
    rotulo: "Aposta máxima",
    descricao:
      "O maior valor aceito numa aposta. É o teto do que alguém pode perder num fut — e, como o pote é dividido, também o que segura uma aposta sozinha de dominar o rateio.",
    min: 1,
    max: 100000,
  },
  aposta_fecha_min_antes: {
    padrao: 15,
    rotulo: "Apostas fecham (min antes do horário)",
    descricao:
      "A margem antes do horário marcado em que as apostas param de ser aceitas. Existe para o fut que começa adiantado: quem já viu a bola rolar não pode mais apostar.",
    min: 0,
    max: 120,
  },
};

export const CHAVES_DE_AJUSTE = Object.keys(AJUSTES) as ChaveDeAjuste[];

/** Os valores vigentes: os padrões acima com as sobrescritas do admin por cima. */
export type Ajustes = Readonly<Record<ChaveDeAjuste, number>>;

export const AJUSTES_PADRAO: Ajustes = Object.fromEntries(
  CHAVES_DE_AJUSTE.map((c) => [c, AJUSTES[c].padrao]),
) as Ajustes;

export function ehChaveDeAjuste(chave: string): chave is ChaveDeAjuste {
  return Object.hasOwn(AJUSTES, chave);
}

/**
 * Mensagem do que impede este valor de ser gravado, ou `null` se ele serve.
 *
 * Devolve texto em vez de lançar porque quem chama é uma Server Action, e o
 * caminho normal dela é mostrar o problema no formulário — não estourar.
 */
export function validarValorDeAjuste(chave: string, valor: number): string | null {
  if (!ehChaveDeAjuste(chave)) return "Esse ajuste não existe.";
  if (!Number.isInteger(valor)) return "Use um número inteiro.";
  const def = AJUSTES[chave];
  if (def.valores) {
    return def.valores.includes(valor)
      ? null
      : `Valores aceitos: ${def.valores.join(", ")}.`;
  }
  if (valor < def.min || valor > def.max) return `Use um número de ${def.min} a ${def.max}.`;
  return null;
}

/**
 * As regras que um ajuste sozinho não consegue ver: as que ligam DOIS deles.
 *
 * `validarValorDeAjuste` julga um número contra a própria faixa, e por isso não
 * enxerga o par. A aposta é o primeiro caso em que o par existe — piso acima do
 * teto passa nas duas faixas e mata a aposta inteira: nenhum valor cabe, toda
 * tentativa vira "fora do limite", e o campo do card nasce com `min` maior que
 * `max`. Os pares que houver moram aqui, nunca no formulário: quem escreve a
 * sobrescrita não é só o painel.
 *
 * Devolve o campo a destacar e o texto, ou `null` quando o conjunto fecha.
 */
export function validarConjuntoDeAjustes(
  vigentes: Ajustes,
): { chave: ChaveDeAjuste; erro: string } | null {
  if (vigentes.aposta_min > vigentes.aposta_max) {
    return {
      chave: "aposta_min",
      erro: "A aposta mínima não pode passar da máxima — assim nenhum valor caberia.",
    };
  }
  return null;
}

/**
 * Aplica as sobrescritas sobre os padrões.
 *
 * Sobrescrita inválida é IGNORADA em vez de derrubar a leitura: o valor pode
 * ter sido gravado por uma versão do código em que a faixa era outra, e uma
 * economia que para de funcionar por causa disso é pior que uma que volta ao
 * padrão. O painel do admin valida na escrita, que é onde dá para avisar.
 */
export function comSobrescritas(sobrescritas: ReadonlyMap<string, number>): Ajustes {
  const vigentes: Record<string, number> = { ...AJUSTES_PADRAO };
  for (const [chave, valor] of sobrescritas) {
    if (validarValorDeAjuste(chave, valor) === null) vigentes[chave] = valor;
  }
  return vigentes as Ajustes;
}

// ── O multiplicador ─────────────────────────────────────────────────────────

// O fator como fração exata é o `FatorDaRodada` de skill.ts — o MESMO tipo, e
// não um gêmeo: este valor é produzido aqui, congelado em
// `zenha_multiplicadores`, e lido de volta lá como `FatorDaRodada` no replay.
// Dois nomes para um conceito não teriam ponto de conversão onde falhar se
// divergissem.
const FATORES: Readonly<Record<number, FatorDaRodada>> = {
  125: { num: 5, den: 4 },
  150: { num: 3, den: 2 },
  200: { num: 2, den: 1 },
};

/**
 * O percentual vira fração exata. Lança em valor desconhecido de propósito:
 * este número vem de uma coluna congelada na compra, e um valor que não está na
 * tabela quer dizer dado corrompido — falhar alto aqui é o que impede isso de
 * virar nota silenciosamente errada, no mesmo espírito do `validar()` de
 * skill.ts.
 */
export function fatorDoPercentual(percent: number): FatorDaRodada {
  const fator = FATORES[percent];
  if (!fator) throw new Error(`Fator de multiplicador desconhecido: ${percent}`);
  return fator;
}

// A escada de preço do multiplicador, por compra já feita no mês corrente.
// Com o preço de tabela de 120 dá 120, 160, 210 e 280 — números redondos por
// construção, não por acaso.
//
// Ela existe porque o multiplicador é o único item recomprável: sem a escada,
// quem tem saldo compraria um por semana e ele deixaria de ser uma aposta para
// virar o estado normal do jogo.
//
// A `base` é o `preco` da linha do consumível em `loja_itens`, e não um ajuste
// da economia — já foi um (`multiplicador_preco_base`), no tempo em que o
// catálogo era código e não havia coluna onde guardá-lo. Com o catálogo no
// banco, manter as duas portas seria dar dois donos ao mesmo número.
const ESCADA_DO_MULTIPLICADOR: readonly (readonly [number, number])[] = [
  [1, 1],
  [4, 3],
  [7, 4],
  [7, 3],
];

export function precoDoMultiplicador(base: number, comprasNoMes: number): number {
  const degrau = ESCADA_DO_MULTIPLICADOR[
    Math.min(Math.max(comprasNoMes, 0), ESCADA_DO_MULTIPLICADOR.length - 1)
  ];
  // Arredondado para múltiplo de 5: preço de loja com terminação quebrada
  // ("213 zenhas") parece erro de conta, não decisão.
  return Math.round((base * degrau[0]) / degrau[1] / 5) * 5;
}

// ── Os fatos e os créditos ──────────────────────────────────────────────────

/**
 * DERIVADO do enum do schema: `motivo` viaja daqui direto para a coluna
 * `zenha_ledger.motivo`, e duas listas escritas à mão só concordam por
 * inspeção. `import type` não traz o drizzle junto, então o módulo segue puro.
 */
export type MotivoDeZenha = ZenhaMotivo;

/** Uma linha pronta para o ledger. `amount` é sempre positivo aqui. */
export type CreditoDeZenha = {
  playerId: number;
  motivo: MotivoDeZenha;
  amount: number;
  dedupeKey: string;
  descricao: string;
  /**
   * De onde veio, quando veio de um fut. As duas FKs são `set null` no banco:
   * apagar o fut não apaga a linha do extrato, só corta o ponteiro — e é por
   * isso que `descricao` é congelada, para a linha continuar legível depois.
   *
   * Ausentes em boas-vindas, que não vem de fut nenhum.
   */
  matchDayId?: number | null;
  roundId?: number | null;
  /**
   * O pedido de recarga que gerou o crédito (motivo `recarga`) — ausente em
   * tudo que vem de fut. Mesma família das duas FKs acima: `set null` no banco,
   * navegação do extrato, nunca chave.
   */
  pedidoId?: number | null;
};

export type FatosDoJogador = {
  playerId: number;
  /** Entrou em campo — tem linha em `game_players` deste fut. */
  jogou: boolean;
  /** Foi convocado para avaliar (linha em `rating_round_raters`). */
  eraRater: boolean;
  enviouAvaliacao: boolean;
  votouMvp: boolean;
  /**
   * Nota antes e depois desta rodada, em centésimos. `null` nos dois quando o
   * jogador não tem linha em `skill_history` — ninguém o avaliou.
   */
  notaAntesCent: number | null;
  notaDepoisCent: number | null;
  /** Quantos dividem o título de melhor em campo. 0 = não é um deles. */
  vencedoresDoMvp: number;
  /** Este fut fechou a sequência de presenças no grupo. */
  fechouStreak: boolean;
  /** Futs que já pagaram a este jogador na semana deste fut. */
  futsPagosNaSemana: number;
};

export type FatosDoFut = {
  matchDayId: number;
  /** A rodada de avaliação do fut. Nula quando o fut encerrou sem rodada. */
  roundId: number | null;
  /** "YYYY-MM-DD". */
  data: string;
  /** Fut avulso não paga: ele não tem grupo para dar contexto a nada. */
  ehDeGrupo: boolean;
  /** Contas ATIVAS distintas que entraram em campo. */
  contasEmCampo: number;
  /**
   * Havia alguém em quem votar para melhor em campo. Quando não havia, a action
   * de avaliar grava `mvp_player_id = null` legitimamente, e cobrar o voto
   * seria cobrar por uma porta trancada.
   */
  haviaCandidatoMvp: boolean;
  /** "fut de 12/08, na Quadra do Zé" — congelado no extrato. */
  descricaoDoFut: string;
  jogadores: readonly FatosDoJogador[];
};

/**
 * O fut paga alguma coisa?
 *
 * O piso de contas em campo é o freio de fabricação: qualquer jogador logado
 * marca fut e vira admin dele, e convidar cria jogador com link de convite na
 * própria tela. Exigir meia dúzia de contas ativas em campo torna a fábrica de
 * fantasmas cara o bastante para deixar de ser atalho — e, de graça, faz fut
 * sem jogo lançado não pagar ninguém.
 */
export function futPaga(fut: FatosDoFut, ajustes: Ajustes): boolean {
  return (
    fut.ehDeGrupo &&
    fut.data >= ZENHA_DESDE &&
    fut.contasEmCampo >= ajustes.min_contas_para_pagar
  );
}

/**
 * Cumpriu o ritual da avaliação?
 *
 * Quem o sistema NÃO convocou passa direto. São dois casos reais: o fut sem
 * rodada de avaliação, e o jogador que caiu num lado com menos gente que o
 * mínimo para avaliar (ver lineup.ts) e por isso nunca virou rater. Nos dois
 * ele jogou, conta para placar e presença, e não teve o que enviar.
 */
export function avaliacaoCumprida(
  j: Pick<FatosDoJogador, "eraRater" | "enviouAvaliacao" | "votouMvp">,
  haviaCandidatoMvp: boolean,
): boolean {
  if (!j.eraRater) return true;
  if (!j.enviouAvaliacao) return false;
  return j.votouMvp || !haviaCandidatoMvp;
}

/**
 * Quanto a nota rendeu nesta rodada.
 *
 * Proporcional à subida — e é isso que faz o multiplicador ter sentido
 * econômico sem uma linha de código a mais: ele amplia o movimento da nota
 * dentro de skill.ts, e o ganho vem ampliado junto.
 *
 * Manter em 10,0 é o único empate que paga, porque é o único de onde não há
 * para onde subir. Qualquer outra nota parada rende zero.
 */
export function zenhaDaNota(
  antesCent: number | null,
  depoisCent: number | null,
  ajustes: Ajustes,
): number {
  if (antesCent === null || depoisCent === null) return 0;
  if (depoisCent === antesCent) {
    return depoisCent === SKILL_MAX_CENT ? ajustes.manter_no_teto : 0;
  }
  if (depoisCent < antesCent) return 0;
  // A nota tem uma casa decimal, então a diferença em centésimos é sempre
  // múltipla de 10. O round é rede contra dado torto, não conversão.
  return Math.round((depoisCent - antesCent) / 10) * ajustes.nota_por_decimo;
}

/**
 * O título dividido divide o prêmio, com piso de 1.
 *
 * `apurarMvp` devolve uma lista de tamanho arbitrário — empate em votos E na
 * média de estrelas —, e pagar o valor cheio a cada um transformaria o empate
 * na melhor coisa que pode acontecer com o grupo.
 */
export function zenhaDoMvp(vencedores: number, ajustes: Ajustes): number {
  // O prêmio zerado desliga a fonte. O piso de 1 vale para a DIVISÃO — um
  // empate grande não pode zerar a parte de quem venceu —, nunca para o
  // desligamento: sem esta primeira guarda, pôr 0 no painel continuaria
  // pagando 1 zenha a cada vencedor, para sempre, e a linha continuaria
  // aparecendo no extrato.
  if (vencedores <= 0 || ajustes.mvp <= 0) return 0;
  return Math.max(1, Math.floor(ajustes.mvp / vencedores));
}

/** Um fut do grupo, do ponto de vista da sequência de um jogador. */
export type FutDaSequencia = {
  matchDayId: number;
  /** Entrou em campo — linha em `game_players`. */
  presente: boolean;
  /** Ficou na lista de espera e não subiu. */
  naEspera: boolean;
};

/**
 * Quantas presenças seguidas, contando de trás para frente a partir do ÚLTIMO
 * fut da lista (que é sempre o que está sendo liquidado).
 *
 * Ficar na espera NÃO quebra a sequência, e também não conta como presença: o
 * fut simplesmente não existe para esta contagem. A pessoa quis ir e o app não
 * deixou — cobrar por isso seria punir quem chegou tarde numa lista cheia.
 * Faltar tendo vaga quebra, e "nunca respondi" quebra igual: os dois são a
 * mesma ausência para quem estava esperando o time.
 */
export function presencasSeguidas(futs: readonly FutDaSequencia[]): number {
  let seguidas = 0;
  for (let i = futs.length - 1; i >= 0; i -= 1) {
    const f = futs[i];
    if (f.presente) seguidas += 1;
    else if (!f.naEspera) break;
  }
  return seguidas;
}

/**
 * A sequência fechou NESTE fut?
 *
 * O múltiplo, e não um contador que zera: "a cada 5 presenças seguidas" é
 * exatamente `seguidas % 5 === 0`, e derivar isso da contagem em vez de guardar
 * estado torna a resposta a mesma sempre que for recalculada. Importa porque a
 * liquidação pode acontecer fora de ordem — um fut cuja rodada de avaliação
 * ainda corre é pago depois de outro mais recente que já fechou —, e com
 * contador materializado a ordem mudaria quem recebe.
 */
export function fechouSequencia(seguidas: number, ajustes: Ajustes): boolean {
  return seguidas > 0 && seguidas % ajustes.streak_tamanho === 0;
}

// Uma casa decimal, vírgula, sem sinal — "0,3" para 30 centésimos.
function decimosEmTexto(cent: number): string {
  return (cent / 100).toFixed(1).replace(".", ",");
}

/**
 * Todas as linhas que este fut gera, prontas para o ledger.
 *
 * Vazio quando o fut não paga. As `dedupeKey` são por FUT, e não por rodada:
 * fut encerrado sem rodada nenhuma ainda paga participação, e uma chave que
 * dependesse de um `roundId` inexistente não teria como ser montada.
 */
export function creditosDoFut(fut: FatosDoFut, ajustes: Ajustes): CreditoDeZenha[] {
  if (!futPaga(fut, ajustes)) return [];

  const linhas: CreditoDeZenha[] = [];
  const chave = (motivo: MotivoDeZenha) => `${motivo}:fut:${fut.matchDayId}`;
  const origem = { matchDayId: fut.matchDayId, roundId: fut.roundId };

  for (const j of fut.jogadores) {
    // Quem não entrou em campo não ganha nada deste fut — nem participação.
    // A presença que conta é a escalação (`game_players`), e não o "Vou" da
    // lista: um é o registro de quem jogou, o outro é uma intenção.
    if (!j.jogou) continue;
    if (j.futsPagosNaSemana >= ajustes.max_futs_pagos_semana) continue;

    if (avaliacaoCumprida(j, fut.haviaCandidatoMvp) && ajustes.participacao > 0) {
      linhas.push({
        playerId: j.playerId,
        ...origem,
        motivo: "participacao",
        amount: ajustes.participacao,
        dedupeKey: chave("participacao"),
        descricao: `Participação no ${fut.descricaoDoFut}`,
      });
    }

    const daNota = zenhaDaNota(j.notaAntesCent, j.notaDepoisCent, ajustes);
    if (daNota > 0) {
      const subiu = j.notaDepoisCent! - j.notaAntesCent!;
      linhas.push({
        playerId: j.playerId,
        ...origem,
        motivo: "nota",
        amount: daNota,
        dedupeKey: chave("nota"),
        descricao:
          subiu > 0
            ? `Sua nota subiu ${decimosEmTexto(subiu)} no ${fut.descricaoDoFut}`
            : `Nota mantida em 10,0 no ${fut.descricaoDoFut}`,
      });
    }

    const doMvp = zenhaDoMvp(j.vencedoresDoMvp, ajustes);
    if (doMvp > 0) {
      linhas.push({
        playerId: j.playerId,
        ...origem,
        motivo: "mvp",
        amount: doMvp,
        dedupeKey: chave("mvp"),
        descricao:
          j.vencedoresDoMvp > 1
            ? `Melhor em campo (título dividido) no ${fut.descricaoDoFut}`
            : `Melhor em campo no ${fut.descricaoDoFut}`,
      });
    }

    if (j.fechouStreak && ajustes.streak_premio > 0) {
      linhas.push({
        playerId: j.playerId,
        ...origem,
        motivo: "streak",
        amount: ajustes.streak_premio,
        dedupeKey: chave("streak"),
        descricao: `${ajustes.streak_tamanho} futs seguidos no grupo`,
      });
    }
  }

  return linhas;
}
