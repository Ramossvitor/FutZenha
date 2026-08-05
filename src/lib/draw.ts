export type DrawPlayer = {
  id: number;
  name: string;
  skill: number;
  isGoalkeeper: boolean;
};

export type DrawnTeam = {
  players: DrawPlayer[];
  skillSum: number;
};

// A nota tem uma casa decimal, então somar em ponto flutuante faria
// `skillSum === minSum` quase nunca bater e o desempate por tamanho de time
// nunca dispararia. Internamente somamos centésimos inteiros.
const toCent = (skill: number) => Math.round(skill * 100);

function shuffle<T>(items: T[], rng: () => number): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Sorteio balanceado: goleiros distribuídos primeiro (1 por time, do melhor
 * pro pior), depois greedy — cada jogador de linha (ordenado por nota desc,
 * com shuffle prévio como desempate aleatório) vai para o time com menor soma
 * de notas que ainda tem vaga. Times ficam com tamanhos iguais ±1.
 */
export function drawTeams(
  playersIn: DrawPlayer[],
  teamCount: number,
  rng: () => number = Math.random,
): DrawnTeam[] {
  if (teamCount < 2) throw new Error("Precisa de pelo menos 2 times");
  if (playersIn.length < teamCount) throw new Error("Menos jogadores que times");

  const n = playersIn.length;
  const base = Math.floor(n / teamCount);
  const remainder = n % teamCount;
  const teams = Array.from({ length: teamCount }, () => ({
    players: [] as DrawPlayer[],
    sumCent: 0,
  }));
  // Os primeiros `remainder` times comportam um jogador a mais.
  const capacity = (i: number) => base + (i < remainder ? 1 : 0);

  const goalkeepers = playersIn
    .filter((p) => p.isGoalkeeper)
    .sort((a, b) => b.skill - a.skill);
  const linePool = playersIn.filter((p) => !p.isGoalkeeper);

  // 1 goleiro por time; goleiros excedentes jogam na linha.
  goalkeepers.slice(0, teamCount).forEach((gk, i) => {
    teams[i].players.push(gk);
    teams[i].sumCent += toCent(gk.skill);
  });
  const line = [...linePool, ...goalkeepers.slice(teamCount)];

  const ordered = shuffle(line, rng).sort((a, b) => b.skill - a.skill);
  for (const player of ordered) {
    const candidates = teams
      .map((team, i) => ({ team, i }))
      .filter(({ team, i }) => team.players.length < capacity(i));
    const minSum = Math.min(...candidates.map((c) => c.team.sumCent));
    let best = candidates.filter((c) => c.team.sumCent === minSum);
    const minLen = Math.min(...best.map((c) => c.team.players.length));
    best = best.filter((c) => c.team.players.length === minLen);
    const chosen = best[Math.floor(rng() * best.length)];
    chosen.team.players.push(player);
    chosen.team.sumCent += toCent(player.skill);
  }

  return teams.map((t) => ({ players: t.players, skillSum: t.sumCent / 100 }));
}
