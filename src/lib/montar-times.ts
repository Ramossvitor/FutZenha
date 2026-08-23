// A parte sem DOM do editor de times: as colunas ("Sem time" + um time por
// coluna), o movimento de um jogador entre elas e a leitura do form do modo
// "montar". Mora aqui, e não no componente client, para ser testável sem
// browser — o mesmo arranjo de puxada.ts / puxar-para-atualizar.tsx.

export type JogadorDeTime = {
  playerId: number;
  nome: string;
  skill: number;
  isGoalkeeper: boolean;
};

/**
 * Uma coluna do editor. `chave` é o que identifica o destino para quem grava:
 * o id do time (em string) depois do sorteio, o lado "A"/"B" no rascunho, e
 * `null` para a coluna "Sem time".
 */
export type ColunaDeTime = {
  chave: string | null;
  nome: string;
  jogadores: JogadorDeTime[];
};

export const SEM_TIME = "Sem time";

/** Os dois lados do modo "montar" — o sorteio de 2 usa os mesmos nomes. */
export const LADOS_DO_RASCUNHO = ["A", "B"] as const;
export type LadoDoRascunho = (typeof LADOS_DO_RASCUNHO)[number];

/**
 * Monta as colunas a partir de quem está em jogo e de onde cada um está.
 * Quem não aparece no mapa (ou aparece com `null`) cai em "Sem time", que é
 * sempre a primeira coluna — mesmo vazia, para o alvo de arrasto existir.
 */
export function repartirEmColunas(
  jogadores: JogadorDeTime[],
  times: { chave: string; nome: string }[],
  ladoPorJogador: ReadonlyMap<number, string | null>,
): ColunaDeTime[] {
  const colunas: ColunaDeTime[] = [
    { chave: null, nome: SEM_TIME, jogadores: [] },
    ...times.map((t) => ({
      chave: t.chave,
      nome: t.nome,
      jogadores: [] as JogadorDeTime[],
    })),
  ];
  const porChave = new Map(colunas.map((c) => [c.chave, c]));
  // Em ordem alfabética, como o servidor devolve (orderBy players.name): quem
  // é movido pousa na posição em que vai estar depois do revalidate, e a
  // lista não se reordena na cara de quem acabou de arrastar.
  const ordenados = [...jogadores].sort((a, b) => a.nome.localeCompare(b.nome));
  for (const j of ordenados) {
    const chave = ladoPorJogador.get(j.playerId) ?? null;
    // Time que não existe mais (chave órfã) cai no "Sem time" em vez de sumir.
    (porChave.get(chave) ?? colunas[0]).jogadores.push(j);
  }
  return colunas;
}

/**
 * O inverso de repartirEmColunas: onde está cada um. É o que o editor usa como
 * base para aplicar os movimentos otimistas e o rascunho por cima, e repartir
 * de novo — as colunas são sempre derivadas, nunca editadas no lugar.
 */
export function ladoPorJogadorDe(
  colunas: ColunaDeTime[],
): Map<number, string | null> {
  const mapa = new Map<number, string | null>();
  for (const c of colunas)
    for (const j of c.jogadores) mapa.set(j.playerId, c.chave);
  return mapa;
}

/**
 * Lê o rascunho guardado no browser (`{ "<playerId>": "A" | "B" }`) com
 * tolerância: string inválida ou valor estranho viram "nada salvo".
 */
export function lerRascunho(salvo: string | null): Map<number, string> {
  const lados = new Map<number, string>();
  if (!salvo) return lados;
  try {
    const obj = JSON.parse(salvo) as unknown;
    if (typeof obj !== "object" || obj === null) return lados;
    for (const [id, lado] of Object.entries(obj)) {
      if (typeof lado === "string" && Number.isInteger(Number(id)))
        lados.set(Number(id), lado);
    }
  } catch {
    // JSON corrompido: começa do zero.
  }
  return lados;
}

/** O rascunho pronto para guardar: só quem tem lado. */
export function serializarRascunho(
  ladoPorJogador: ReadonlyMap<number, string | null>,
): string {
  const obj: Record<string, string> = {};
  for (const [id, lado] of ladoPorJogador) if (lado !== null) obj[id] = lado;
  return JSON.stringify(obj);
}

/**
 * Soma em centésimos inteiros, como o painel sempre fez: acumular a nota
 * decimal em ponto flutuante mostraria "Σ 34,400000000000006".
 */
export function somaDeNotas(jogadores: JogadorDeTime[]): number {
  return jogadores.reduce((acc, j) => acc + Math.round(j.skill * 100), 0) / 100;
}

/**
 * O form do modo "montar": um campo `lado-<playerId>` por jogador, valendo
 * "A" ou "B". Só quem está confirmado conta — id que não está na lista (saiu
 * entre o rascunho e o submit, ou veio forjado) é ignorado, e quem está na
 * lista sem lado volta em `semLado` para a action recusar com mensagem.
 */
export function lerLadosDoForm(
  formData: FormData,
  confirmadosIds: number[],
): { lados: Map<number, LadoDoRascunho>; semLado: number[] } {
  const lados = new Map<number, LadoDoRascunho>();
  const semLado: number[] = [];
  for (const id of confirmadosIds) {
    const valor = formData.get(`lado-${id}`);
    if (valor === "A" || valor === "B") lados.set(id, valor);
    else semLado.push(id);
  }
  return { lados, semLado };
}
