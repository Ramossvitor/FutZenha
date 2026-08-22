// O que um item da loja é, para quem só precisa DESENHÁ-LO.
//
// Puro de propósito — sem banco, sem `server-only` — porque a vitrine, o
// inventário, o perfil público, cada linha de ranking e o painel do admin leem a
// mesma forma, e metade deles é componente que não pode arrastar drizzle junto.
// Quem lê do banco é src/lib/loja-itens.ts; aqui só moram o formato e as
// decisões que não dependem de consulta nenhuma.
//
// ── Por que isto substituiu um catálogo em código ───────────────────────────
//
// Havia aqui um array de vinte e cinco itens com nome, piada e token de cor, e o
// argumento era bom enquanto valeu: item cosmético precisa de arte, e migration
// nenhuma carrega arte. O que mudou foi a arte — o badge passou a ser uma IMAGEM
// que o admin envia, e produto cuja identidade é upload não nasce de deploy.
// Sobrou deste arquivo o que era mesmo código: a ordem das prateleiras, o
// tamanho da vitrine e a tradução de tipo para lugar no perfil.

import type { LojaTipo, ZenhaSlot } from "@/db/schema";

/**
 * DERIVADOS dos enums do schema, e não cópias à mão: os dois viajam direto para
 * colunas (`loja_itens.tipo`, `zenha_equipados.slot`), e duas listas escritas
 * separadamente só concordam por inspeção. `import type` não arrasta o drizzle
 * para o bundle, então o módulo continua puro — é o que match-day-form.ts faz
 * com `StatusFut`.
 */
export type TipoDeItem = LojaTipo;
export type SlotDeExibicao = ZenhaSlot;

/**
 * O que um item consumível FAZ em campo.
 *
 * Um valor só, e é intencional que acrescentar outro seja caro: efeito novo é
 * motor novo (ver src/lib/multiplicador-engine.ts), não linha de catálogo. O
 * check do banco carrega a mesma lista.
 */
export type EfeitoDeItem = "multiplicador";
export const EFEITO_DO_MULTIPLICADOR: EfeitoDeItem = "multiplicador";

/**
 * Um item da loja como o resto do app o enxerga.
 *
 * `Readonly` não é decoração: estes objetos atravessam a página inteira e um
 * `item.preco = …` num componente distraído seria um preço mentindo para o
 * usuário até o próximo request. Aqui o TypeScript recusa antes.
 *
 * Os bytes da imagem NÃO estão aqui — só o hash, que é o que monta a URL. É a
 * mesma separação que `loja_imagens` faz no banco, e pela mesma razão: a leitura
 * quente da loja quer desenhar `<img>`, não carregar duzentos kilobytes por
 * item.
 */
export type ItemDaLoja = Readonly<{
  id: number;
  tipo: TipoDeItem;
  nome: string;
  descricao: string;
  preco: number;
  /** `#rrggbb`. Só moldura e cor do nome; nulo no resto. */
  cor: string | null;
  /** Só badge; nulo no resto. */
  imagemHash: string | null;
  efeito: EfeitoDeItem | null;
  ativo: boolean;
}>;

/**
 * Quantos badges cabem na vitrine do perfil.
 *
 * Cinco porque a vitrine é uma ESCOLHA: mostrar tudo o que se comprou não diz
 * nada sobre a pessoa, e o teto é o que transforma a coleção em curadoria. O
 * número está aqui e é `check (posicao between 1 and 5)` no banco — a tela usa
 * este, o banco garante o dele, e mudar um sem o outro quebra alto em vez de
 * silenciosamente aceitar um sexto.
 */
export const VAGAS_NA_VITRINE = 5;

/** Formato de cor aceito. Minúsculas: a normalização é da escrita, não da leitura. */
export const REGEX_DE_COR = /^#[0-9a-f]{6}$/;

/**
 * Os limites do formulário do admin.
 *
 * Aqui, e não só no zod, porque o `maxLength` do campo e a recusa da action
 * precisam ser o MESMO número: com dois, o formulário deixa digitar o que a
 * action depois recusa — e o admin descobre isso depois de escrever.
 *
 * `PRECO_MAXIMO` é alto de propósito: não é regra de produto, é freio contra
 * dedo escorregado (um zero a mais tira o item de circulação sem ninguém
 * perceber). O `check (preco <= 100000)` de `loja_itens` é o par dele.
 */
export const PRECO_MAXIMO = 100_000;
export const NOME_MAXIMO = 40;
export const DESCRICAO_MAXIMA = 200;

/**
 * Teto de um badge, em bytes.
 *
 * 200 KB é folgado para uma imagem de 256×256 (o formulário recorta e reduz
 * antes de enviar, e o resultado costuma ficar abaixo de 30 KB) e apertado o
 * bastante para as imagens caberem no Postgres sem a tabela virar problema.
 *
 * Mora AQUI, e não em src/lib/imagem-de-item.ts (que é quem o aplica), pelo
 * mesmo motivo mecânico de `MIN_SENHA` em src/lib/regras.ts: o campo de imagem
 * do admin é Client Component e mostra o limite na tela, e `imagem-de-item.ts`
 * importa `node:crypto` — um número vindo de lá arrastaria o módulo inteiro
 * para o bundle do cliente.
 */
export const TAMANHO_MAXIMO_DA_IMAGEM = 200 * 1024;

/**
 * A cor é obrigatória exatamente onde ela É o produto, e proibida no resto.
 *
 * Espelha o `check (tipo in ('moldura','cor_do_nome')) = (cor is not null)` de
 * `loja_itens` — o banco é quem garante, isto é quem consegue explicar. Uma
 * função e não dois `if` espalhados: a criação e a edição precisam da mesma
 * resposta, e na edição o tipo vem do banco, não do formulário.
 */
export function corBateComTipo(tipo: TipoDeItem, cor: string | null): boolean {
  return (tipo === "moldura" || tipo === "cor_do_nome") === (cor !== null);
}

/**
 * A ordem das prateleiras na loja.
 *
 * O consumível abre a vitrine com o zero: é o único item que mexe no jogo e o
 * único recomprável — enterrá-lo depois dos cosméticos é escondê-lo. Badge vem
 * logo atrás porque é o que a loja existe para vender.
 *
 * `Record` fechado, e não lista: tipo novo em `TipoDeItem` sem posição aqui não
 * compila. Com uma lista, `indexOf` devolveria -1 e o tipo recém-nascido pularia
 * calado para a frente de todo mundo — defeito que só aparece olhando a tela.
 */
export const ORDEM_DAS_PRATELEIRAS: Readonly<Record<TipoDeItem, number>> = {
  consumivel: 0,
  badge: 1,
  moldura: 2,
  cor_do_nome: 3,
  titulo: 4,
};

/**
 * Onde este item aparece no perfil quando o lugar é de vaga ÚNICA — ou `null`
 * quando ele não tem slot.
 *
 * Badge devolve `null` e isso é a regra do produto, não um esquecimento: ele vai
 * para a vitrine (até cinco, ver `VAGAS_NA_VITRINE`), e slot é justamente a
 * promessa de que só cabe um. O consumível devolve `null` porque não se pendura
 * em perfil nenhum: ele se arma num fut.
 *
 * `Record` fechado pelo mesmo motivo de `ORDEM_DAS_PRATELEIRAS`.
 */
const SLOT_DO_TIPO: Readonly<Record<TipoDeItem, SlotDeExibicao | null>> = {
  badge: null,
  consumivel: null,
  moldura: "moldura",
  cor_do_nome: "cor_do_nome",
  titulo: "titulo",
};

export function slotDoItem(item: Pick<ItemDaLoja, "tipo">): SlotDeExibicao | null {
  return SLOT_DO_TIPO[item.tipo];
}

export function ehConsumivel(item: Pick<ItemDaLoja, "tipo">): boolean {
  return item.tipo === "consumivel";
}

/**
 * É O multiplicador?
 *
 * Pelo `efeito`, e não pelo id nem pelo nome: o id é linha de banco (muda entre
 * dev, teste e produção) e o nome é editável pelo admin. O efeito é o que o
 * código implementa, e a unique parcial do banco garante que só uma linha o
 * tenha.
 */
export function ehMultiplicador(item: Pick<ItemDaLoja, "efeito">): boolean {
  return item.efeito === EFEITO_DO_MULTIPLICADOR;
}

/**
 * A URL pública da imagem deste item, ou `null` se ele não tem imagem.
 *
 * O hash do CONTEÚDO vai no caminho, e é isso que deixa a rota responder
 * `immutable` por um ano: trocar a imagem troca a URL, então nenhum cache
 * segura arte velha. Sem ele, a alternativa seria `?v=` (que CDN às vezes
 * ignora) ou cache curto em toda linha de ranking.
 */
export function urlDaImagemDoItem(item: Pick<ItemDaLoja, "id" | "imagemHash">): string | null {
  return item.imagemHash === null ? null : `/imagens/loja/${item.id}/${item.imagemHash}`;
}

/**
 * Os itens na ordem da vitrine: prateleira, depois o mais barato, depois o mais
 * antigo.
 *
 * O id desempata porque `preco` empata o tempo todo (seis badges a 250) e sem um
 * terceiro critério a ordem seria a que o `sort` do runtime resolvesse — a loja
 * dançaria entre renders, e o teste que compara duas chamadas passaria por sorte.
 *
 * Devolve array NOVO: quem chama é componente de servidor que pode querer
 * fatiar, e um `sort()` sobre o array do chamador reordenaria a lista dele por
 * baixo.
 */
export function ordenarParaVitrine<T extends Pick<ItemDaLoja, "tipo" | "preco" | "id">>(
  itens: readonly T[],
): T[] {
  return [...itens].sort(
    (a, b) =>
      ORDEM_DAS_PRATELEIRAS[a.tipo] - ORDEM_DAS_PRATELEIRAS[b.tipo] ||
      a.preco - b.preco ||
      a.id - b.id,
  );
}
