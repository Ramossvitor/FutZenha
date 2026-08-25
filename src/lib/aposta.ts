// A regra da aposta. Pura de propósito — sem banco, sem `server-only` — pelo
// mesmo motivo de zenha.ts e mvp.ts: aqui errar é pagar a pessoa errada, e a
// /guia precisa poder importar as regras sem arrastar drizzle junto.
//
// Quem chama isto (src/lib/aposta-engine.ts) resolve os FATOS no banco — quem
// jogou por qual time, qual foi o placar — e entrega listas; aqui só se decide
// quem venceu e quanto cada um leva.
//
// ── O desenho, e o que cada peça dele defende ──────────────────────────────
//
// **Aposta cega na própria vitória.** O único mercado é "eu vou ganhar este
// fut", e ele fecha enquanto o fut ainda está `scheduled` — antes de os times
// existirem. Apostar só em si alinha o incentivo (quem apostou quer ganhar,
// nunca entregar o jogo); apostar às cegas tira a vantagem de quem veria o
// sorteio antes de decidir.
//
// **Pote dividido, soma zero.** Os perdedores pagam os vencedores e mais
// ninguém entra na conta: `Σ retornos <= Σ apostado`, sempre. É por isso que a
// aposta NÃO precisa dos freios de fabricação da liquidação do fut
// (`min_contas_para_pagar`, `max_futs_pagos_semana`): fut de mentira não cria
// zenha aqui, só a transfere entre gente que já poderia combinar qualquer coisa
// fora do site. O que se perde no arredondamento para baixo não é pago a
// ninguém — a alternativa (dar a sobra a alguém) seria criar um critério de
// desempate onde não há mérito nenhum a premiar.
//
// **Na dúvida, devolve.** Trocou de time no meio do fut, não entrou em campo,
// ninguém venceu, todo mundo apostou "junto" — em qualquer um desses a aposta
// volta pelo valor exato. Devolver nunca paga mais do que se arriscou, então
// nenhum desses caminhos é explorável: no máximo desfaz a aposta.

/** Um jogo encerrado, reduzido ao que a apuração precisa. */
export type JogoApurado = {
  teamAId: number;
  teamBId: number;
  scoreA: number;
  scoreB: number;
};

/**
 * O time que venceu o FUT: o que somou mais vitórias nos jogos do dia.
 *
 * Empate no número de vitórias é decidido pelo saldo de gols do dia; empate
 * também no saldo devolve `null`, e `null` quer dizer "ninguém venceu" — todas
 * as apostas voltam. Não existe segundo critério de desempate de propósito:
 * qualquer coisa além de vitórias e saldo (gols marcados, confronto direto,
 * ordem dos jogos) seria uma regra que ninguém combinou em campo, decidindo
 * dinheiro.
 *
 * O fut pode ter até TIMES_MAX times em rodízio, então isto conta por time e
 * não por "lado A × lado B".
 */
export function vencedorDoFut(jogos: readonly JogoApurado[]): number | null {
  if (jogos.length === 0) return null;

  const vitorias = new Map<number, number>();
  const saldo = new Map<number, number>();
  const soma = (mapa: Map<number, number>, time: number, quanto: number) =>
    mapa.set(time, (mapa.get(time) ?? 0) + quanto);

  for (const jogo of jogos) {
    // Todo time que entrou em campo precisa existir nos dois mapas, mesmo
    // zerado: sem isto, quem só empatou não seria candidato a nada e um fut de
    // empates escolheria um vencedor entre os ausentes da conta.
    soma(vitorias, jogo.teamAId, 0);
    soma(vitorias, jogo.teamBId, 0);
    soma(saldo, jogo.teamAId, jogo.scoreA - jogo.scoreB);
    soma(saldo, jogo.teamBId, jogo.scoreB - jogo.scoreA);
    if (jogo.scoreA > jogo.scoreB) soma(vitorias, jogo.teamAId, 1);
    else if (jogo.scoreB > jogo.scoreA) soma(vitorias, jogo.teamBId, 1);
  }

  const maisVitorias = Math.max(...vitorias.values());
  const lideres = [...vitorias.keys()].filter((time) => vitorias.get(time) === maisVitorias);
  if (lideres.length === 1) return lideres[0];

  const melhorSaldo = Math.max(...lideres.map((time) => saldo.get(time) ?? 0));
  const comMelhorSaldo = lideres.filter((time) => (saldo.get(time) ?? 0) === melhorSaldo);
  return comMelhorSaldo.length === 1 ? comMelhorSaldo[0] : null;
}

/**
 * Por qual time o apostador disputou, segundo o snapshot `game_players`.
 *
 * `teamIds` é o time dele em cada jogo que jogou, na ordem dos jogos.
 * `trocouDeLadoNoLog` é a existência de linha dele em `trocas_de_lado` naquele
 * fut — a troca feita com o jogo em andamento, que mexe no snapshot do jogo
 * atual e por isso nem sempre aparece como divergência entre jogos.
 *
 * Os dois sinais são evidência append-only: nascem de gravações que ninguém
 * reescreve depois. Quem trocou de time não perde nada — a aposta volta —, e é
 * essa devolução que impede a troca de virar ferramenta: sair do time que está
 * perdendo desfaz a aposta, nunca a transforma em prêmio.
 */
export function timeDoApostador(
  teamIds: readonly number[],
  trocouDeLadoNoLog: boolean,
): { teamId: number } | "nao-jogou" | "trocou-de-time" {
  if (teamIds.length === 0) return "nao-jogou";
  if (trocouDeLadoNoLog) return "trocou-de-time";
  const primeiro = teamIds[0];
  return teamIds.every((t) => t === primeiro) ? { teamId: primeiro } : "trocou-de-time";
}

/** Uma aposta que chegou até a divisão: só as que disputaram de verdade. */
export type ApostaEmDisputa = {
  apostaId: number;
  valor: number;
  vencedora: boolean;
};

export type DesfechoCalculado = {
  apostaId: number;
  retorno: number;
  desfecho: "paga" | "perdida" | "devolvida";
};

/**
 * Divide o pote entre as vencedoras.
 *
 * Vencedora leva a própria aposta de volta MAIS a fatia proporcional do que os
 * perdedores puseram: `valor + floor(perdido * valor / ganho)`. Perdedora leva
 * zero.
 *
 * Sem vencedoras ou sem perdedoras, todas voltam pelo valor. São os dois casos
 * em que não há aposta nenhuma acontecendo: se todo mundo apostou e todo mundo
 * ganhou (ou todo mundo perdeu), ninguém arriscou nada contra ninguém, e ficar
 * com o dinheiro de quem errou sem ter para quem dar seria a casa embolsando —
 * e casa é justamente o que este desenho não tem.
 *
 * O `floor` deixa sobra de até um a menos que o número de vencedoras, e essa
 * sobra não é paga. O invariante que importa — e que o teste cobra — é
 * `Σ retornos <= Σ valores`: nenhuma zenha nasce aqui.
 */
export function dividirPote(apostas: readonly ApostaEmDisputa[]): DesfechoCalculado[] {
  const vencedoras = apostas.filter((a) => a.vencedora);
  const perdedoras = apostas.filter((a) => !a.vencedora);

  if (vencedoras.length === 0 || perdedoras.length === 0) {
    return apostas.map((a) => ({ apostaId: a.apostaId, retorno: a.valor, desfecho: "devolvida" }));
  }

  const ganho = vencedoras.reduce((soma, a) => soma + a.valor, 0);
  const perdido = perdedoras.reduce((soma, a) => soma + a.valor, 0);

  return apostas.map((a) =>
    a.vencedora
      ? {
          apostaId: a.apostaId,
          retorno: a.valor + Math.floor((perdido * a.valor) / ganho),
          desfecho: "paga" as const,
        }
      : { apostaId: a.apostaId, retorno: 0, desfecho: "perdida" as const },
  );
}
