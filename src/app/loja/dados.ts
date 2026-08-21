import "server-only";
import { getVitrine, type ItemDaVitrine } from "@/lib/loja";
import type { SlotDeExibicao } from "@/lib/loja-catalogo";

// O recorte da vitrine para a TELA: a lista plana que `getVitrine` devolve
// virando prateleiras com nome e subtítulo.
//
// Fica aqui, e não em src/lib/loja.ts, porque é texto de vitrine — nada disto é
// consultado pelo motor da compra, pelo painel do admin ou pelo perfil público.
// A ordem, sim, é do catálogo (`itensAVenda` já entrega consumível primeiro,
// depois badge, moldura, cor do nome e título): esta função só QUEBRA a lista
// onde o slot muda, então acrescentar item novo lá não pede nada aqui.

/** A chave da prateleira: o slot, ou "consumivel" para o item de slot nulo. */
type ChaveDePrateleira = SlotDeExibicao | "consumivel";

export type Prateleira = {
  chave: ChaveDePrateleira;
  titulo: string;
  /** Uma linha dizendo o que aquilo faz — a piada é do item, não da prateleira. */
  descricao: string;
  itens: ItemDaVitrine[];
};

/**
 * `Record` fechado, e não um objeto solto: slot novo em `SlotDeExibicao` sem
 * texto aqui não compila. Com um `?? "Outros"` de reserva, a prateleira nova
 * apareceria sem nome na loja e ninguém descobriria pelo build.
 */
const TEXTOS: Readonly<Record<ChaveDePrateleira, { titulo: string; descricao: string }>> = {
  consumivel: {
    titulo: "O que muda o jogo",
    descricao:
      "O único item que faz alguma coisa em campo — e o único que dá para comprar de novo.",
  },
  badge: {
    titulo: "Badges",
    descricao: "O selo que aparece do lado do seu nome. Um por vez.",
  },
  moldura: {
    titulo: "Molduras",
    descricao: "O anel em volta da sua foto no perfil e nas listas.",
  },
  cor_do_nome: {
    titulo: "Cores do nome",
    descricao: "Seu nome, na cor que você escolher. Vale em todo lugar do app.",
  },
  titulo: {
    titulo: "Títulos",
    descricao: "A linha embaixo do seu nome. A mais cara de todas as vaidades.",
  },
};

export type DadosDaLoja = {
  saldo: number;
  /** Quantos multiplicadores ele já comprou neste mês — a escada já subiu isto. */
  multiplicadoresNoMes: number;
  prateleiras: Prateleira[];
};

export async function carregarLoja(playerId: number): Promise<DadosDaLoja> {
  const vitrine = await getVitrine(playerId);

  const prateleiras: Prateleira[] = [];
  for (const daVitrine of vitrine.itens) {
    const chave = daVitrine.item.slot ?? "consumivel";
    // A lista já vem agrupada por slot, então basta olhar a última prateleira
    // aberta. Um `Map` por chave daria o mesmo resultado e perderia a ordem que
    // o catálogo escolheu a dedo — o consumível abrindo a loja, e não enterrado
    // depois de vinte e quatro cosméticos.
    const ultima = prateleiras.at(-1);
    if (ultima?.chave === chave) ultima.itens.push(daVitrine);
    else prateleiras.push({ chave, ...TEXTOS[chave], itens: [daVitrine] });
  }

  return {
    saldo: vitrine.saldo,
    multiplicadoresNoMes: vitrine.multiplicadoresNoMes,
    prateleiras,
  };
}

/**
 * Um item da vitrine pelo id — o que a tela de confirmação precisa.
 *
 * Passa pelo MESMO `getVitrine` da lista, e não por uma consulta própria: são o
 * preço e o "já possui" que decidem o que a confirmação oferece, e duas
 * consultas para o mesmo par divergiriam no dia em que a escada ou a regra de
 * posse mudasse. `undefined` = o item existe no catálogo mas não está à venda
 * (aposentado), que é caso de tela, não de 404.
 */
export async function carregarItemDaLoja(playerId: number, itemId: string) {
  const vitrine = await getVitrine(playerId);
  return {
    saldo: vitrine.saldo,
    multiplicadoresNoMes: vitrine.multiplicadoresNoMes,
    // Só a tela de confirmação mostra a força: é onde a pessoa decide gastar.
    fatorDoMultiplicador: vitrine.fatorDoMultiplicador,
    daVitrine: vitrine.itens.find((i) => i.item.id === itemId),
  };
}
