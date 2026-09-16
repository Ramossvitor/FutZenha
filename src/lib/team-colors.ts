// O colete de um time: nome livre e cor livre.
//
// Já foi "nome de time é cor de colete", com uma tabela de sete nomes para sete
// classes do Tailwind — e "Com Colete" saía cinza. A cor agora é coluna
// (`teams.cor`: `#rrggbb`, ou nulo = sem colete) e o nome não decide nada. O que
// sobrou de paleta aqui é o que ainda precisa ser código: as sete cores
// clássicas de camisa (as amostras do seletor) e os seis padrões que nomeiam o
// sorteio de fut avulso ou de grupo sem coletes.
//
// Puro de propósito: o editor de times e o painel da súmula são client
// components e leem daqui; quem vai ao banco é ./coletes-do-grupo.ts.

export type Colete = { nome: string; cor: string | null };

/**
 * As sete cores clássicas, minúsculas como o `check` do banco exige. Eram os
 * tokens `--vest-*` do globals.css. O preenchimento nunca mudou entre temas —
 * é a cor da camisa —, então virar constante não perdeu nada; quem trocava
 * com o tema era a BORDA, que agora sai de color-mix com o `--fg` para
 * qualquer cor (ver `colete-livre` no globals.css e o VestChip).
 */
export const CORES_DE_COLETE = {
  preto: "#15181a",
  branco: "#e8edea",
  verde: "#16a868",
  laranja: "#f2740f",
  azul: "#2f6fe0",
  vermelho: "#d9342a",
  amarelo: "#f5c518",
} as const;

/** As amostras de um toque do seletor de cor — as sete, Amarelo inclusive. */
export const SWATCHES_DE_COLETE: readonly { nome: string; cor: string }[] = [
  { nome: "Preto", cor: CORES_DE_COLETE.preto },
  { nome: "Branco", cor: CORES_DE_COLETE.branco },
  { nome: "Verde", cor: CORES_DE_COLETE.verde },
  { nome: "Laranja", cor: CORES_DE_COLETE.laranja },
  { nome: "Azul", cor: CORES_DE_COLETE.azul },
  { nome: "Vermelho", cor: CORES_DE_COLETE.vermelho },
  { nome: "Amarelo", cor: CORES_DE_COLETE.amarelo },
];

/**
 * Os padrões do sorteio: seis, na ordem em que os times saem. Sem Amarelo de
 * propósito — é a paleta que sempre nomeou o fut avulso (Preto × Branco
 * primeiro), e mudar a ordem mudaria o nome dos times de todo mundo.
 */
export const COLETES_PADRAO: readonly Colete[] = SWATCHES_DE_COLETE.slice(0, 6);

/**
 * Os dois valores do rádio de cor que não são hex — o vocabulário entre o
 * CamposDoColete (que os emite) e o coletes-form.ts (que os lê). Aqui, e não
 * no form, para o componente não arrastar o zod para o bundle do cliente.
 */
export const ESCOLHA_OUTRA_COR = "outra";
export const ESCOLHA_SEM_COLETE = "sem";

/**
 * O rádio de cor que o form abre marcado — no vocabulário acima: a cor gravada
 * se for uma amostra, "outra" se for um tom livre, "sem colete" para cor nula;
 * sem nada gravado (`undefined`), o padrão da posição, e sem padrão, "sem
 * colete". Pura e aqui, e não dentro do CamposDoColete, para ter teste ao lado:
 * o unit não renderiza .tsx.
 */
export function escolhaInicialDoColete(
  cor: string | null | undefined,
  corPadrao: string | null,
): string {
  if (cor === null) return ESCOLHA_SEM_COLETE;
  if (cor === undefined) return corPadrao ?? ESCOLHA_SEM_COLETE;
  return SWATCHES_DE_COLETE.some((amostra) => amostra.cor === cor) ? cor : ESCOLHA_OUTRA_COR;
}

/**
 * O nome como se compara: sem espaço nas pontas e sem caixa. "Preto" e
 * " preto " são o mesmo time — e dois times com o mesmo nome seriam dois
 * botões "Gol do Preto" na súmula.
 */
export function chaveDoNomeDeTime(nome: string): string {
  return nome.trim().toLowerCase();
}

/**
 * Os coletes de um sorteio de `quantidade` times: primeiro os do grupo, na
 * ordem; faltando, os padrões cujo nome o grupo ainda não usou; faltando ainda,
 * "Time N" sem cor. Sempre devolve exatamente `quantidade` entradas com nomes
 * únicos (pela chaveDoNomeDeTime) — é o que o form de edição exige depois, e
 * o que a súmula precisa para os dois botões de gol não dizerem a mesma coisa.
 */
export function completarColetes(presets: readonly Colete[], quantidade: number): Colete[] {
  const coletes = presets.slice(0, quantidade).map((c) => ({ nome: c.nome, cor: c.cor }));
  const tomados = new Set(coletes.map((c) => chaveDoNomeDeTime(c.nome)));
  for (const padrao of COLETES_PADRAO) {
    if (coletes.length >= quantidade) break;
    if (tomados.has(chaveDoNomeDeTime(padrao.nome))) continue;
    coletes.push({ nome: padrao.nome, cor: padrao.cor });
    tomados.add(chaveDoNomeDeTime(padrao.nome));
  }
  for (let n = coletes.length + 1; coletes.length < quantidade; n++) {
    const nome = `Time ${n}`;
    if (tomados.has(chaveDoNomeDeTime(nome))) continue;
    coletes.push({ nome, cor: null });
    tomados.add(chaveDoNomeDeTime(nome));
  }
  return coletes;
}
