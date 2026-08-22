import "server-only";
import type { TipoDeItem } from "@/lib/item-da-loja";
import { getVitrine, type ItemDaVitrine } from "@/lib/loja";

// O recorte da vitrine para a TELA: a lista plana que `getVitrine` devolve
// virando prateleiras com nome e subtítulo.
//
// Fica aqui, e não em src/lib/loja.ts, porque é texto de vitrine — nada disto é
// consultado pelo motor da compra, pelo painel do admin ou pelo perfil público.
// A ordem, sim, é do módulo puro (`ordenarParaVitrine` já entrega consumível
// primeiro, depois badge, moldura, cor do nome e título): esta função só QUEBRA
// a lista onde o tipo muda, então item novo no banco não pede nada aqui.

export type Prateleira = {
  chave: TipoDeItem;
  titulo: string;
  /** Uma linha dizendo o que aquilo faz — a piada é do item, não da prateleira. */
  descricao: string;
  itens: ItemDaVitrine[];
};

/**
 * `Record` fechado, e não um objeto solto: tipo novo em `TipoDeItem` sem texto
 * aqui não compila. Com um `?? "Outros"` de reserva, a prateleira nova apareceria
 * sem nome na loja e ninguém descobriria pelo build.
 */
const TEXTOS: Readonly<Record<TipoDeItem, { titulo: string; descricao: string }>> = {
  consumivel: {
    titulo: "O que muda o jogo",
    descricao:
      "O único item que faz alguma coisa em campo — e o único que dá para comprar de novo.",
  },
  badge: {
    titulo: "Badges",
    descricao:
      "A figura que vai para o seu perfil. Cabem cinco na vitrine, e uma delas anda junto do seu nome nas listas.",
  },
  moldura: {
    titulo: "Molduras",
    descricao: "O anel em volta do seu avatar no perfil.",
  },
  cor_do_nome: {
    titulo: "Cores do nome",
    descricao: "Seu nome, na cor que você escolher.",
  },
  titulo: {
    titulo: "Títulos",
    descricao: "A cápsula ao lado do seu nome no perfil. A mais cara de todas as vaidades.",
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
    const chave = daVitrine.item.tipo;
    // A lista já vem agrupada por tipo, então basta olhar a última prateleira
    // aberta. Um `Map` por chave daria o mesmo resultado e perderia a ordem que
    // `ORDEM_DAS_PRATELEIRAS` escolheu a dedo — o consumível abrindo a loja, e
    // não enterrado depois dos cosméticos.
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
 * posse mudasse. `undefined` = o item existe mas não está à venda, que é caso de
 * tela, não de 404.
 */
export async function carregarItemDaLoja(playerId: number, itemId: number) {
  const vitrine = await getVitrine(playerId);
  return {
    saldo: vitrine.saldo,
    multiplicadoresNoMes: vitrine.multiplicadoresNoMes,
    // Só a tela de confirmação mostra a força: é onde a pessoa decide gastar.
    fatorDoMultiplicador: vitrine.fatorDoMultiplicador,
    daVitrine: vitrine.itens.find((i) => i.item.id === itemId),
  };
}
