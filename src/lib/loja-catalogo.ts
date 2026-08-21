// O catálogo da loja. Puro de propósito — sem banco, sem `server-only` — porque
// a vitrine, o inventário, o perfil e o painel do admin leem a MESMA lista, e
// porque é assim que o vitest unit alcança a trava de ids congelados.
//
// O catálogo é CÓDIGO, e não linha de tabela. Cada item tem nome escrito, piada
// própria e token de cor; migration nenhuma carrega isso, e uma tabela guardaria
// metade da verdade pedindo migration a cada badge novo. É o precedente já
// declarado da casa (guia/capitulos.ts + corpos.tsx, shell/nav-items.tsx) e o
// motivo de `zenha_inventario.item_id` ser text sem FK.
//
// ── A regra dura ────────────────────────────────────────────────────────────
//
// NUNCA apagar uma entrada daqui. Item que sai de venda vira `aposentado: true`
// e FICA, para sempre, mesmo que ninguém nunca mais o veja na vitrine.
//
// `zenha_inventario.item_id` aponta para estes ids sem FK nenhuma para segurar a
// ponta: apagar a entrada não apaga a linha de quem comprou — deixa a linha
// apontando para o vazio, e o perfil da pessoa quebra por um badge que só o
// catálogo esqueceu. Não existe conserto barato depois: a zenha que pagou aquele
// item já saiu do ledger, que é append-only, e não há estorno a rodar. Aposentar
// custa uma linha; apagar é irreversível.
//
// A lista congelada em loja-catalogo.test.ts é essa regra virando trava: sumir
// com um item quebra o teste antes de quebrar o perfil de alguém.

import type { ZenhaSlot } from "@/db/schema";
import { AJUSTES } from "./zenha";

// ── Os tokens de cor ────────────────────────────────────────────────────────
//
// `tokenId` é o ID de um token semântico, NUNCA uma classe do Tailwind. Duas
// razões, nesta ordem: cor crua no .tsx derruba o gate de lint do projeto, e o
// Tailwind gera utilitário varrendo o fonte — `bg-${item.tokenId}` nunca
// existiria no CSS final, que é o bug silencioso que team-colors.ts documenta.
// A tradução ID → classe literal mora num Record do componente da vitrine, e a
// família `--zenha-*` nasce em globals.css ao lado dos `--vest-*`, com os dois
// temas resolvidos.
//
// O conjunto é PEQUENO e fechado de propósito: sete cores para vinte e cinco
// itens, reaproveitadas à vontade. Item novo escolhe um token que já existe; se
// pedir cor nova, a cor nasce primeiro no CSS — nunca no meio do catálogo.
export type TokenDeItem =
  | "zenha-grama"
  | "zenha-cal"
  | "zenha-brasa"
  | "zenha-ouro"
  | "zenha-ceu"
  | "zenha-uva"
  | "zenha-carvao";

/**
 * Onde o item aparece no perfil.
 *
 * DERIVADO do enum do schema, e não uma cópia à mão: são os mesmos quatro
 * valores, e enquanto forem duas listas um slot novo na migration deixaria o
 * catálogo, a vitrine e o inventário para trás em silêncio. `import type` não
 * arrasta o drizzle para o bundle, então o módulo continua puro — é o mesmo que
 * `match-day-form.ts` faz com `StatusFut`.
 */
export type SlotDeExibicao = ZenhaSlot;

// A forma de uma entrada ANTES de o TypeScript conhecer os ids — `id: string`
// aqui só para que `IdDeItem` possa ser derivado da lista logo abaixo. Quem
// consome usa `ItemDaLoja`, com o id já estreitado.
type EntradaDoCatalogo = {
  id: string;
  nome: string;
  descricao: string;
  /** `null` só no consumível: multiplicador não fica pendurado no perfil. */
  slot: SlotDeExibicao | null;
  /**
   * Preço PADRÃO, e só ele. O que a vitrine mostra e o que a compra cobra saem
   * de `precoVigente` — o admin pode ter mexido, e no consumível este número
   * nem é o dono do preço (ver `precoVigente`).
   */
  preco: number;
  consumivel: boolean;
  aposentado: boolean;
  tokenId: TokenDeItem;
};

const ITENS = [
  // ── O consumível ──────────────────────────────────────────────────────────
  // Único item recomprável e único que faz alguma coisa em campo. O preço vem
  // do ajuste do admin em zenha.ts em vez de repetido aqui: o número tem dono, e
  // duas cópias dele divergiriam no dia em que alguém mexesse numa só.
  {
    id: "multiplicador-de-nota",
    nome: "Multiplicador de nota",
    descricao:
      "Arma num fut e amplia o movimento da sua nota. Nos dois sentidos — é aposta, não presente.",
    slot: null,
    preco: AJUSTES.multiplicador_preco_base.padrao,
    consumivel: true,
    aposentado: false,
    tokenId: "zenha-brasa",
  },

  // ── Badges comuns ─────────────────────────────────────────────────────────
  {
    id: "dono-da-bola",
    nome: "Dono da bola",
    descricao: "A bola é dele. O fut acaba quando ele decide que acabou.",
    slot: "badge",
    preco: 250,
    consumivel: false,
    aposentado: false,
    tokenId: "zenha-grama",
  },
  {
    id: "perna-de-pau",
    nome: "Perna de pau",
    descricao: "Assumido e com orgulho. Ninguém te chama do que você já se chamou.",
    slot: "badge",
    preco: 250,
    consumivel: false,
    aposentado: false,
    tokenId: "zenha-carvao",
  },
  {
    id: "sempre-atrasado",
    nome: "Sempre atrasado",
    descricao: "Chega no segundo tempo e reclama do primeiro.",
    slot: "badge",
    preco: 250,
    consumivel: false,
    aposentado: false,
    tokenId: "zenha-brasa",
  },
  {
    id: "goleiro-de-linha",
    nome: "Goleiro de linha",
    descricao: "Foi para o gol porque ninguém queria. Nunca mais saiu de lá.",
    slot: "badge",
    preco: 250,
    consumivel: false,
    aposentado: false,
    tokenId: "zenha-cal",
  },
  {
    id: "primeiro-a-confirmar",
    nome: "Primeiro a confirmar",
    descricao: "Confirma na segunda o fut de sábado. E cobra os outros na quarta.",
    slot: "badge",
    preco: 250,
    consumivel: false,
    aposentado: false,
    tokenId: "zenha-ceu",
  },
  {
    id: "cobrador-de-falta",
    nome: "Cobrador de falta",
    descricao: "Pegou, é golaço. Não pegou, ninguém viu.",
    slot: "badge",
    preco: 250,
    consumivel: false,
    aposentado: false,
    tokenId: "zenha-uva",
  },

  // ── Cores do nome ─────────────────────────────────────────────────────────
  {
    id: "nome-grama",
    nome: "Nome verde-grama",
    descricao: "A cor do campo em dia de chuva na véspera.",
    slot: "cor_do_nome",
    preco: 400,
    consumivel: false,
    aposentado: false,
    tokenId: "zenha-grama",
  },
  {
    id: "nome-cal",
    nome: "Nome cal",
    descricao: "Branco de linha de cal. Discreto até alguém pisar em cima.",
    slot: "cor_do_nome",
    preco: 400,
    consumivel: false,
    aposentado: false,
    tokenId: "zenha-cal",
  },
  {
    id: "nome-brasa",
    nome: "Nome brasa",
    descricao: "Para quem chega quente e sai fumaçando.",
    slot: "cor_do_nome",
    preco: 400,
    consumivel: false,
    aposentado: false,
    tokenId: "zenha-brasa",
  },
  {
    id: "nome-ceu",
    nome: "Nome céu",
    descricao: "Azul de fim de tarde, que é quando o fut fica bom.",
    slot: "cor_do_nome",
    preco: 400,
    consumivel: false,
    aposentado: false,
    tokenId: "zenha-ceu",
  },
  {
    id: "nome-uva",
    nome: "Nome uva",
    descricao: "Roxo. Como a canela de quem entrou de sola em você.",
    slot: "cor_do_nome",
    preco: 400,
    consumivel: false,
    aposentado: false,
    tokenId: "zenha-uva",
  },
  {
    id: "nome-carvao",
    nome: "Nome carvão",
    descricao: "Preto de colete lavado umas trinta vezes.",
    slot: "cor_do_nome",
    preco: 400,
    consumivel: false,
    aposentado: false,
    tokenId: "zenha-carvao",
  },

  // ── Molduras ──────────────────────────────────────────────────────────────
  {
    id: "moldura-de-rede",
    nome: "Moldura de rede",
    descricao: "A do fundo do gol. Todo chute quer chegar nela.",
    slot: "moldura",
    preco: 600,
    consumivel: false,
    aposentado: false,
    tokenId: "zenha-cal",
  },
  {
    id: "moldura-de-cal",
    nome: "Moldura de cal",
    descricao: "A linha que ninguém respeita no cruzamento.",
    slot: "moldura",
    preco: 600,
    consumivel: false,
    aposentado: false,
    tokenId: "zenha-grama",
  },
  {
    id: "moldura-de-esparadrapo",
    nome: "Moldura de esparadrapo",
    descricao: "Segura a caneleira, o dedo e o que sobrou da dignidade.",
    slot: "moldura",
    preco: 600,
    consumivel: false,
    aposentado: false,
    tokenId: "zenha-brasa",
  },
  {
    id: "moldura-de-ouro",
    nome: "Moldura de ouro",
    descricao: "Cara, brilhosa e absolutamente inútil em campo. Perfeita.",
    slot: "moldura",
    preco: 600,
    consumivel: false,
    aposentado: false,
    tokenId: "zenha-ouro",
  },

  // ── Títulos ───────────────────────────────────────────────────────────────
  {
    id: "titulo-camisa-10",
    nome: "Camisa 10",
    descricao: "Anda pouco e decide muito. Pelo menos é o que ele conta.",
    slot: "titulo",
    preco: 750,
    consumivel: false,
    aposentado: false,
    tokenId: "zenha-ouro",
  },
  {
    id: "titulo-muralha",
    nome: "Muralha",
    descricao: "Passar por ele dá cansaço só de pensar.",
    slot: "titulo",
    preco: 750,
    consumivel: false,
    aposentado: false,
    tokenId: "zenha-carvao",
  },
  {
    id: "titulo-tecnico-do-grupo",
    nome: "Técnico do grupo",
    descricao: "Grita a escalação de dentro do campo, correndo menos que todo mundo.",
    slot: "titulo",
    preco: 750,
    consumivel: false,
    aposentado: false,
    tokenId: "zenha-ceu",
  },
  {
    id: "titulo-craque-da-resenha",
    nome: "Craque da resenha",
    descricao: "Joga o que joga, mas o pós-fut não seria o mesmo sem ele.",
    slot: "titulo",
    preco: 750,
    consumivel: false,
    aposentado: false,
    tokenId: "zenha-uva",
  },

  // ── Badges raros ──────────────────────────────────────────────────────────
  {
    id: "chapeu-do-ano",
    nome: "Chapéu do ano",
    descricao: "Um chapéu só. O grupo comenta até hoje.",
    slot: "badge",
    preco: 1200,
    consumivel: false,
    aposentado: false,
    tokenId: "zenha-uva",
  },
  {
    id: "bicicleta",
    nome: "Bicicleta",
    descricao: "Aconteceu uma vez na vida. Uma vez basta.",
    slot: "badge",
    preco: 1200,
    consumivel: false,
    aposentado: false,
    tokenId: "zenha-brasa",
  },
  {
    id: "defesa-do-ano",
    nome: "Defesa do ano",
    descricao: "Voou no ângulo e ainda levantou reclamando do zagueiro.",
    slot: "badge",
    preco: 1200,
    consumivel: false,
    aposentado: false,
    tokenId: "zenha-ceu",
  },

  // ── O lendário ────────────────────────────────────────────────────────────
  {
    id: "bola-de-ouro-do-fut",
    nome: "Bola de ouro do fut",
    descricao: "O item mais caro da loja não te faz jogar melhor. Nunca fez.",
    slot: "badge",
    preco: 3000,
    consumivel: false,
    aposentado: false,
    tokenId: "zenha-ouro",
  },
] as const satisfies readonly EntradaDoCatalogo[];

/** Os ids do catálogo — inclusive os aposentados, que nunca saem daqui. */
export type IdDeItem = (typeof ITENS)[number]["id"];

/**
 * `Readonly` não é decoração: `itensAVenda()` devolve array novo, mas com os
 * MESMOS objetos que o CATALOGO indexa, e o módulo vive enquanto o processo do
 * servidor viver. Um `item.preco = precoVigente(...)` num componente distraído
 * não estragaria uma render — estragaria o catálogo de todo mundo até o próximo
 * deploy. Aqui o TypeScript recusa antes.
 */
export type ItemDaLoja = Readonly<Omit<EntradaDoCatalogo, "id"> & { id: IdDeItem }>;

/**
 * O catálogo indexado por id.
 *
 * `Object.keys` aqui devolve a ordem de DECLARAÇÃO: as chaves são kebab-case, e
 * só chave que parece índice de array é reordenada pelo motor do JS. É essa
 * ordem que a lista congelada do teste compara.
 */
export const CATALOGO = Object.fromEntries(ITENS.map((item) => [item.id, item])) as Readonly<
  Record<IdDeItem, ItemDaLoja>
>;

/**
 * O consumível, nomeado.
 *
 * Quem arma, quem cobra a escada de preço e quem monta a vitrine precisam
 * apontar para ele, e um literal solto em três arquivos é um typo esperando a
 * vez — aqui o TypeScript cobra que o id exista.
 */
export const ID_DO_MULTIPLICADOR: IdDeItem = "multiplicador-de-nota";

export function ehIdDeItem(id: string): id is IdDeItem {
  return Object.hasOwn(CATALOGO, id);
}

// O preço de cada item mora em `zenha_config` junto com os ajustes da economia,
// num espaço de chaves próprio. Prefixo em vez de tabela separada porque é uma
// sobrescrita inteira como qualquer outra — e o painel do admin lê tudo de um
// SELECT só.
const PREFIXO_DE_PRECO = "preco:";

export function chaveDePreco(id: IdDeItem): string {
  return `${PREFIXO_DE_PRECO}${id}`;
}

/** O item desta chave de preço, ou `null` se ela não for uma. */
export function itemDaChaveDePreco(chave: string): IdDeItem | null {
  if (!chave.startsWith(PREFIXO_DE_PRECO)) return null;
  const id = chave.slice(PREFIXO_DE_PRECO.length);
  return ehIdDeItem(id) ? id : null;
}

/**
 * O preço de VITRINE do COSMÉTICO: a sobrescrita do admin, ou o padrão do
 * catálogo.
 *
 * Sobrescrita quebrada (não-inteira, negativa) é IGNORADA em vez de derrubar a
 * loja — mesma filosofia do `comSobrescritas` de zenha.ts. O valor pode ter sido
 * gravado por uma versão do código em que a faixa era outra, e uma loja que para
 * de abrir por causa disso é pior que uma que volta ao preço de fábrica.
 *
 * ── Não serve para o consumível ─────────────────────────────────────────────
 *
 * O preço do multiplicador NÃO mora em `preco:multiplicador-de-nota`: ele mora
 * no ajuste `multiplicador_preco_base` da economia, e o número que a vitrine
 * mostra é o primeiro degrau da escada daquele mês — quem resolve isso é
 * `precoParaEste` (src/lib/loja.ts), o único dono do preço do consumível.
 * Ambos os chamadores daqui já excluem o multiplicador antes de chamar.
 *
 * O corolário: `preco:multiplicador-de-nota` é chave morta. Ninguém a lê, e o
 * painel do admin não oferece o campo — o número já tem dono, e o campo daria a
 * impressão de ter mudado um preço que segue exatamente onde estava.
 */
export function precoVigente(id: IdDeItem, sobrescritas: ReadonlyMap<string, number>): number {
  const bruto = sobrescritas.get(chaveDePreco(id));
  if (bruto === undefined || !Number.isInteger(bruto) || bruto < 0) return CATALOGO[id].preco;
  return bruto;
}

// A ordem das prateleiras. O consumível (slot `null`) abre a vitrine com o zero:
// é o único item que mexe no jogo e o único que dá para comprar de novo —
// enterrá-lo depois de vinte e quatro cosméticos é escondê-lo.
//
// `Record` fechado, e não lista: slot novo em `SlotDeExibicao` sem posição aqui
// não compila. Com uma lista, `indexOf` devolveria -1 e o slot recém-nascido
// pularia silenciosamente para a frente do consumível — bug de vitrine que só
// aparece olhando a tela.
const ORDEM_DE_VITRINE: Readonly<Record<SlotDeExibicao, number>> = {
  badge: 1,
  moldura: 2,
  cor_do_nome: 3,
  titulo: 4,
};

const posicaoNaVitrine = (slot: SlotDeExibicao | null): number =>
  slot === null ? 0 : ORDEM_DE_VITRINE[slot];

// Posição de declaração, para desempatar itens de mesmo slot e mesmo preço.
// Sem isto, a ordem entre os seis badges de 250 seria a que o `sort` do
// runtime resolvesse — e a vitrine dançaria entre renders.
const ORDEM_DE_DECLARACAO = new Map<string, number>(ITENS.map((item, i) => [item.id, i]));

/**
 * Os itens à venda, agrupados por prateleira e do mais barato ao mais caro.
 *
 * Aposentado não aparece: ele continua no CATALOGO para o perfil de quem
 * comprou continuar sabendo desenhá-lo, e some só da vitrine.
 *
 * A ordenação usa o preço PADRÃO, e não o vigente, porque quem chama ainda não
 * leu o `zenha_config` (a função é pura e sem argumento, de propósito). Na
 * prática o admin mexe em preço uma vez por ano; trocar isso por uma vitrine
 * que só monta depois de um SELECT é caro para o problema que resolve.
 *
 * Devolve um array novo a cada chamada — a lista é de leitura, mas quem chama é
 * um componente de servidor que pode querer fatiar, e um `sort()` distraído
 * sobre o array compartilhado reordenaria a loja inteira para todo mundo.
 */
export function itensAVenda(): ItemDaLoja[] {
  const aVenda: ItemDaLoja[] = ITENS.filter((item) => !item.aposentado);
  return aVenda.sort(
    (a, b) =>
      posicaoNaVitrine(a.slot) - posicaoNaVitrine(b.slot) ||
      a.preco - b.preco ||
      ORDEM_DE_DECLARACAO.get(a.id)! - ORDEM_DE_DECLARACAO.get(b.id)!,
  );
}
