// Como foi o fut: placar por jogo, quem marcou, quem jogou de que lado.
//
// Módulo puro — sem `server-only`, sem drizzle — pelo mesmo motivo de
// ./freios-de-envio e ./sumula: a parte que merece teste é a derivação, e o
// vitest unit roda sem config e sem alias. Quem vai ao banco é ./resumo-do-fut.
//
// Existe porque o resumo passou a ter TRÊS leitores — a página do fut, a tela
// de avaliação e o e-mail de encerramento — e o que eles precisam concordar é
// justamente a parte sutil: de que colete saiu cada gol. Ver `coleteDoGol`.

import { jogoEmAndamento } from "./sumula";

export type GolDoResumo = {
  /** Apelido ou nome de quem marcou. Nulo é gol contra / sem autor. */
  autor: string | null;
  quantidade: number;
  /** Nome do time, para o colete. Vazio quando não dá para saber o lado. */
  time: string;
};

export type JogoDoResumo = {
  id: number;
  timeA: string;
  timeB: string;
  placarA: number;
  placarB: number;
  emAndamento: boolean;
  gols: GolDoResumo[];
};

export type TimeDoResumo = {
  id: number;
  nome: string;
  jogadores: { playerId: number; rotulo: string; isGoalkeeper: boolean }[];
};

export type ArtilheiroDoResumo = { playerId: number; rotulo: string; gols: number };

export type ResumoDoFut = {
  jogos: JogoDoResumo[];
  times: TimeDoResumo[];
  /** Gols somados no fut inteiro. Gol sem autor não entra — não há a quem creditar. */
  artilheiros: ArtilheiroDoResumo[];
  totalDeGols: number;
};

export type EntradaDoResumo = {
  times: { id: number; name: string; sortOrder: number }[];
  jogos: {
    id: number;
    teamAId: number;
    teamBId: number;
    scoreA: number;
    scoreB: number;
    sortOrder: number;
    startedAt: Date | null;
    finishedAt: Date | null;
  }[];
  /** Só os gols vivos — quem filtra `desfeito_em` é quem consulta. */
  gols: {
    gameId: number;
    playerId: number | null;
    playerName: string | null;
    nickname: string | null;
    quantity: number;
    side: "A" | "B" | null;
  }[];
  escalacao: { gameId: number; playerId: number; side: "A" | "B" }[];
  elencos: {
    teamId: number;
    playerId: number;
    name: string;
    nickname: string | null;
    isGoalkeeper: boolean;
  }[];
};

/** Apelido quando existe, nome quando não. A regra de exibição do app inteiro. */
function rotuloDe(nome: string, apelido: string | null): string {
  return apelido ?? nome;
}

export function montarResumo(entrada: EntradaDoResumo): ResumoDoFut {
  const nomeDoTime = new Map(entrada.times.map((t) => [t.id, t.name]));

  // Chave `jogo:jogador` porque a mesma pessoa pode trocar de lado entre jogos —
  // o colete do fut (team_players) não responde por ela, só a escalação do jogo.
  const ladoNoJogo = new Map(
    entrada.escalacao.map((e) => [`${e.gameId}:${e.playerId}`, e.side] as const),
  );

  const jogos = [...entrada.jogos]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
    .map((jogo): JogoDoResumo => {
      const timeA = nomeDoTime.get(jogo.teamAId) ?? "";
      const timeB = nomeDoTime.get(jogo.teamBId) ?? "";

      return {
        id: jogo.id,
        timeA,
        timeB,
        placarA: jogo.scoreA,
        placarB: jogo.scoreB,
        emAndamento: jogoEmAndamento(jogo),
        gols: entrada.gols
          .filter((g) => g.gameId === jogo.id)
          .map((g) => ({
            autor: g.playerId === null ? null : rotuloDe(g.playerName ?? "", g.nickname),
            quantidade: g.quantity,
            time: coleteDoGol(g, jogo.id, ladoNoJogo, timeA, timeB),
          })),
      };
    });

  const times = [...entrada.times]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
    .map(
      (time): TimeDoResumo => ({
        id: time.id,
        nome: time.name,
        jogadores: entrada.elencos
          .filter((m) => m.teamId === time.id)
          .map((m) => ({
            playerId: m.playerId,
            rotulo: rotuloDe(m.name, m.nickname),
            isGoalkeeper: m.isGoalkeeper,
          }))
          .sort((a, b) => a.rotulo.localeCompare(b.rotulo, "pt-BR")),
      }),
    );

  return {
    jogos,
    times,
    artilheiros: apurarArtilheiros(entrada.gols),
    totalDeGols: entrada.gols.reduce((soma, g) => soma + g.quantity, 0),
  };
}

/**
 * De que colete saiu este gol, com os dois fallbacks — a regra que existia
 * inline em /fut/[id] e que este módulo veio unificar.
 *
 * O `side` GRAVADO no gol manda. Ele é o lado no instante do gol, e a súmula ao
 * vivo (e o addGoal de hoje) sempre o grava. A escalação do jogo diz outra
 * coisa — o lado em que a pessoa TERMINOU o jogo —, e depois de uma troca de
 * lado no meio da partida (`trocarDeLado`) as duas divergem de propósito: o gol
 * pertence ao time que o marcou, não ao time em que o autor acabou. Enquanto a
 * escalação vinha na frente, o gol trocava de dono junto com o jogador, e o
 * placar do resumo parava de bater com os chips ao lado dele.
 *
 * A escalação fica de fallback para o que veio antes da súmula, quando
 * `goals.side` era nulo e o lado só era derivável por ela. Sem os dois, string
 * vazia: o chip neutro é mais honesto do que chutar um lado.
 */
function coleteDoGol(
  gol: { playerId: number | null; side: "A" | "B" | null },
  gameId: number,
  ladoNoJogo: Map<string, "A" | "B">,
  timeA: string,
  timeB: string,
): string {
  const lado =
    gol.side ??
    (gol.playerId === null ? undefined : ladoNoJogo.get(`${gameId}:${gol.playerId}`));
  if (lado === null || lado === undefined) return "";
  return lado === "A" ? timeA : timeB;
}

/**
 * Artilharia do dia, somando os jogos.
 *
 * Empate desempata por nome, e não pela ordem em que os gols saíram: a lista é
 * lida por gente que jogou junto, e "por que ele veio antes de mim com os
 * mesmos dois gols" é pergunta que ordem de inserção não sabe responder.
 */
function apurarArtilheiros(gols: EntradaDoResumo["gols"]): ArtilheiroDoResumo[] {
  const porJogador = new Map<number, ArtilheiroDoResumo>();

  for (const gol of gols) {
    if (gol.playerId === null) continue;
    const atual = porJogador.get(gol.playerId);
    if (atual) {
      atual.gols += gol.quantity;
      continue;
    }
    porJogador.set(gol.playerId, {
      playerId: gol.playerId,
      rotulo: rotuloDe(gol.playerName ?? "", gol.nickname),
      gols: gol.quantity,
    });
  }

  return [...porJogador.values()].sort(
    (a, b) => b.gols - a.gols || a.rotulo.localeCompare(b.rotulo, "pt-BR"),
  );
}

/** "3 jogos · 14 gols" — a linha curta do assunto do e-mail e do cabeçalho. */
export function linhaDePlacar(resumo: ResumoDoFut): string {
  const jogos = `${resumo.jogos.length} ${resumo.jogos.length === 1 ? "jogo" : "jogos"}`;
  const gols = `${resumo.totalDeGols} ${resumo.totalDeGols === 1 ? "gol" : "gols"}`;
  return `${jogos} · ${gols}`;
}
