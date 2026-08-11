// A lista do fut: quem ocupa vaga, quem espera e quem sobe quando uma vaga
// abre. Módulo puro de propósito — sem `server-only`, sem drizzle, sem
// `redirect` —, pelo mesmo motivo de ./permissions: é a única forma de testar as
// regras no vitest, que aqui roda sem config e sem alias.
//
// A ideia toda cabe em duas frases. A ordem da lista é `confirmed_at`, e não
// `updated_at`: o marco é de quando a pessoa entrou, e qualquer edição do admin
// mexeria no segundo. E o estado é **persistido** (`in` vs `waitlist`), não
// recalculado a cada leitura — com a lista fechada o admin inclui quem apareceu
// na quadra, e aí é normal haver mais gente dentro do que vagas. Uma derivação
// esperta rebaixaria essa gente para a espera na próxima renderização.

/** Espelha `attendance_status` no schema — importar de lá traria o drizzle junto. */
export type StatusPresenca = "in" | "out" | "waitlist" | "no_show";

/**
 * A lista trava no sorteio: daí em diante quem mexe nela é o admin do fut.
 *
 * Mora aqui, e não em ./presenca, porque a tela também precisa da regra — e o
 * módulo de lá é `server-only`.
 */
export function listaFechada(status: "scheduled" | "teams_drawn" | "finished"): boolean {
  return status !== "scheduled";
}

export type LinhaDaLista = {
  playerId: number;
  status: StatusPresenca;
  confirmedAt: Date | null;
};

/**
 * Ordem de chegada, com o id como desempate.
 *
 * O desempate não é preciosismo: duas confirmações no mesmo instante são
 * comuns quando o admin cadastra várias pessoas em sequência, e sem ele a fila
 * mudaria de ordem entre dois renders da mesma tela — o primeiro da espera
 * seria um a cada vez que a página recarregasse.
 *
 * `confirmedAt` nulo vai para o fim: é quem não tem marco de entrada, e chutar
 * que chegou primeiro daria a ele a vaga de quem estava na fila.
 */
function compararChegada(a: LinhaDaLista, b: LinhaDaLista): number {
  const ta = a.confirmedAt?.getTime() ?? Number.POSITIVE_INFINITY;
  const tb = b.confirmedAt?.getTime() ?? Number.POSITIVE_INFINITY;
  return ta === tb ? a.playerId - b.playerId : ta - tb;
}

export function ordenarPorChegada<T extends LinhaDaLista>(linhas: T[]): T[] {
  return [...linhas].sort(compararChegada);
}

/**
 * A lista repartida para a tela, cada parte já na ordem de chegada.
 *
 * Reparte pelo status gravado — não recalcula o corte pelo limite. Ver o
 * cabeçalho do módulo para o porquê.
 */
export function repartirLista<T extends LinhaDaLista>(
  linhas: T[],
): { vagas: T[]; espera: T[]; faltas: T[]; fora: T[] } {
  const ordenadas = ordenarPorChegada(linhas);
  return {
    vagas: ordenadas.filter((l) => l.status === "in"),
    espera: ordenadas.filter((l) => l.status === "waitlist"),
    faltas: ordenadas.filter((l) => l.status === "no_show"),
    fora: ordenadas.filter((l) => l.status === "out"),
  };
}

/**
 * Se quem está confirmando agora entra como vaga ou como espera.
 *
 * `ocupadas` é quantos já estão `in` **sem contar quem está confirmando** — do
 * contrário, alguém que já está na lista e reconfirma disputaria a própria vaga
 * e cairia para a espera.
 *
 * Limite nulo é o padrão de todo fut que não informou vagas, e nele não
 * existe espera: todo mundo entra.
 */
export function statusAoConfirmar(
  ocupadas: number,
  maxPlayers: number | null,
): "in" | "waitlist" {
  if (maxPlayers === null) return "in";
  return ocupadas < maxPlayers ? "in" : "waitlist";
}

/**
 * Quantas vagas sobram, ou null quando o fut não tem limite.
 *
 * Nunca negativo: com a lista fechada o admin inclui quem apareceu na quadra, e
 * "-2 vagas" na tela não quer dizer nada para quem está lendo.
 */
export function vagasLivres(ocupadas: number, maxPlayers: number | null): number | null {
  if (maxPlayers === null) return null;
  return Math.max(0, maxPlayers - ocupadas);
}

/**
 * Quem sobe quando uma vaga abre: o primeiro da espera por ordem de chegada.
 *
 * Devolve a linha inteira, e não só o id, porque quem chama precisa do
 * `playerId` para o update e do resto para a notificação.
 */
export function proximoDaEspera<T extends LinhaDaLista>(linhas: T[]): T | null {
  const espera = ordenarPorChegada(linhas).filter((l) => l.status === "waitlist");
  return espera[0] ?? null;
}
