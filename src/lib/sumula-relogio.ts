// As regras da súmula pelo relógio que dá para decidir sem banco — mesma razão
// de ./sumula.ts: módulo puro (sem drizzle, sem server-only) é a única forma de
// testar a matriz no vitest. Quem resolve os fatos (a lista de futs operáveis,
// a escalação do jogo aberto) é a API em src/app/api/sumula.
//
// O que há de especial aqui é o cliente: um Atalho do Apple Watch, que não
// digita id, escolhe de listas e dita nomes. Cada função abaixo existe para
// uma dessas limitações.

export type CandidatoAFut = {
  id: number;
  temJogoAberto: boolean;
  /** |data do fut − hoje| em dias, contado pelo Postgres. */
  distanciaEmDias: number;
  /**
   * Criador, delegado, admin do grupo ou presente na lista. O que o admin da
   * plataforma alcança só por ser admin fica de fora — ele opera qualquer fut,
   * mas não está em qualquer fut.
   */
  vinculoDireto: boolean;
};

export type EscolhaDeFut<T> =
  | { tipo: "um"; fut: T }
  | { tipo: "nenhum" }
  | { tipo: "varios"; candidatos: T[] };

/**
 * "Qual fut estou operando agora?" — a pergunta que o relógio nunca digita.
 *
 * Os candidatos já vêm filtrados por `teams_drawn` e por permissão; aqui só se
 * escolhe. Primeiro os de vínculo direto, e só na falta deles os que o admin
 * da plataforma alcança por ser admin — sem essa ordem, quem administra a
 * plataforma cairia em `varios-futs` toda semana em que dois grupos sorteiam.
 * Dentro do nível, jogo aberto ganha de qualquer data (a bola está rolando em
 * algum lugar); sem jogo aberto, o fut de data mais próxima. Empate em qualquer
 * critério é `varios`: escolher por id seria acertar por sorte, e lançar gol no
 * fut errado é o pior resultado possível.
 */
export function escolherFutParaOperar<T extends CandidatoAFut>(
  candidatos: readonly T[],
): EscolhaDeFut<T> {
  const diretos = candidatos.filter((c) => c.vinculoDireto);
  const universo = diretos.length > 0 ? diretos : [...candidatos];
  if (universo.length === 0) return { tipo: "nenhum" };

  const abertos = universo.filter((c) => c.temJogoAberto);
  if (abertos.length === 1) return { tipo: "um", fut: abertos[0] };
  if (abertos.length > 1) return { tipo: "varios", candidatos: abertos };

  const menor = Math.min(...universo.map((c) => c.distanciaEmDias));
  const proximos = universo.filter((c) => c.distanciaEmDias === menor);
  return proximos.length === 1
    ? { tipo: "um", fut: proximos[0] }
    : { tipo: "varios", candidatos: proximos };
}

/**
 * Rótulo → playerId, com rótulos únicos ("Zé", "Zé (2)", …).
 *
 * É a forma que o Atalho consome: "Escolher da Lista" sobre as CHAVES de um
 * dicionário e "Obter Valor do Dicionário" com a chave escolhida. Chave
 * repetida sumiria com um jogador — dois "Zé" no mesmo lado viram um só no
 * JSON —, daí o sufixo. O `Object.create(null)` é porque o rótulo vem do
 * apelido, e um apelido "constructor" acharia a chave já ocupada num objeto
 * comum.
 */
export function rotulosUnicos(
  jogadores: readonly { playerId: number; rotulo: string }[],
): Record<string, number> {
  const mapa: Record<string, number> = Object.create(null);
  for (const j of jogadores) {
    let rotulo = j.rotulo;
    for (let n = 2; Object.hasOwn(mapa, rotulo); n++) rotulo = `${j.rotulo} (${n})`;
    mapa[rotulo] = j.playerId;
  }
  return mapa;
}

/** O maior `integer` do Postgres — todo id da casa é `serial`. */
const MAX_INT4 = 2_147_483_647;

/**
 * Um inteiro vindo do JSON do Atalho — que às vezes manda número e às vezes
 * manda a string do número, conforme a ação que produziu o valor. Ausente
 * (`undefined`, `null`, `""`) é "não informado", e é caso legítimo: o gol sem
 * autor não traz `playerId`.
 *
 * Só o que cabe num id: negativo ou acima de int4 passaria daqui e estouraria
 * no Postgres (22003), que não é recusa de negócio — sairia como 500 sem o
 * `{erro, mensagem}` que o atalho lê.
 */
export function lerInteiro(valor: unknown): { ok: true; valor: number | null } | { ok: false } {
  if (valor === undefined || valor === null || valor === "") return { ok: true, valor: null };
  const numero =
    typeof valor === "number"
      ? valor
      : typeof valor === "string" && /^\d+$/.test(valor.trim())
        ? Number(valor.trim())
        : NaN;
  return Number.isInteger(numero) && numero >= 0 && numero <= MAX_INT4
    ? { ok: true, valor: numero }
    : { ok: false };
}

export function lerLado(valor: unknown): "A" | "B" | null {
  if (typeof valor !== "string") return null;
  const lado = valor.trim().toUpperCase();
  return lado === "A" || lado === "B" ? lado : null;
}

/** "Preto 2 × 1 Branco" — a frase que o relógio mostra depois de cada toque. */
export function fraseDoPlacar(p: {
  timeA: string;
  timeB: string;
  scoreA: number;
  scoreB: number;
}): string {
  return `${p.timeA} ${p.scoreA} × ${p.scoreB} ${p.timeB}`;
}

/** Sem acento, sem maiúscula, sem espaço sobrando — a régua da comparação de nomes. */
function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * O autor do gol a partir de um nome DITADO no relógio, procurado na escalação
 * de um lado só.
 *
 * Três níveis, cada um só vale se for único: igual ao apelido ou ao nome;
 * depois começo do apelido ou do nome ("rafa" → "Rafael"); depois começo de
 * qualquer palavra do nome ("costa" → "Rafael Costa"). Dois candidatos no
 * mesmo nível é falha, e não "o primeiro": creditar o gol à pessoa errada é
 * pior do que pedir para escolher da lista.
 */
export function resolverAutor(
  texto: string,
  escalacao: readonly { playerId: number; nome: string; apelido: string | null }[],
): { ok: true; playerId: number } | { ok: false } {
  const alvo = normalizar(texto);
  if (!alvo) return { ok: false };

  const nomes = escalacao.map((j) => ({
    playerId: j.playerId,
    nome: normalizar(j.nome),
    apelido: j.apelido === null ? null : normalizar(j.apelido),
  }));
  const niveis: ((j: (typeof nomes)[number]) => boolean)[] = [
    (j) => j.nome === alvo || j.apelido === alvo,
    (j) => j.nome.startsWith(alvo) || (j.apelido !== null && j.apelido.startsWith(alvo)),
    (j) => j.nome.split(" ").some((palavra) => palavra.startsWith(alvo)),
  ];
  for (const casa of niveis) {
    const achados = nomes.filter(casa);
    if (achados.length === 1) return { ok: true, playerId: achados[0].playerId };
    if (achados.length > 1) return { ok: false };
  }
  return { ok: false };
}
