import { describe, expect, it } from "vitest";
// schema.ts não é `server-only` e só importa drizzle — o vitest unit alcança.
// Importar o enum de VERDADE, e não repetir os quatro nomes aqui, é o que faz
// slot novo no catálogo sem migration correspondente quebrar este teste.
import { zenhaSlotEnum, type ZenhaSlot } from "@/db/schema";
import {
  CATALOGO,
  chaveDePreco,
  ehIdDeItem,
  ID_DO_MULTIPLICADOR,
  type IdDeItem,
  itemDaChaveDePreco,
  itensAVenda,
  precoVigente,
  type SlotDeExibicao,
} from "./loja-catalogo";
import { AJUSTES } from "./zenha";

const IDS = Object.keys(CATALOGO) as IdDeItem[];
const ITENS = Object.values(CATALOGO);

/**
 * A lista congelada.
 *
 * Literal na mão de propósito — este array é a regra dura do arquivo virando
 * trava: apagar uma entrada do catálogo derruba o teste antes de deixar
 * `zenha_inventario.item_id` de alguém apontando para o vazio.
 *
 * Item NOVO no fim da lista é adição normal e só pede uma linha aqui. Item que
 * sai de venda vira `aposentado: true` e CONTINUA nesta lista — se você veio
 * remover um id daqui, é quase certo que o que você queria era aposentá-lo.
 */
const IDS_CONGELADOS = [
  "multiplicador-de-nota",
  "dono-da-bola",
  "perna-de-pau",
  "sempre-atrasado",
  "goleiro-de-linha",
  "primeiro-a-confirmar",
  "cobrador-de-falta",
  "nome-grama",
  "nome-cal",
  "nome-brasa",
  "nome-ceu",
  "nome-uva",
  "nome-carvao",
  "moldura-de-rede",
  "moldura-de-cal",
  "moldura-de-esparadrapo",
  "moldura-de-ouro",
  "titulo-camisa-10",
  "titulo-muralha",
  "titulo-tecnico-do-grupo",
  "titulo-craque-da-resenha",
  "chapeu-do-ano",
  "bicicleta",
  "defesa-do-ano",
  "bola-de-ouro-do-fut",
];

describe("CATALOGO", () => {
  it("nenhum id sumiu nem trocou de nome", () => {
    expect(IDS).toEqual(IDS_CONGELADOS);
    expect(IDS).toHaveLength(25);
  });

  it("ids são únicos e batem com a chave que os indexa", () => {
    expect(new Set(IDS).size).toBe(IDS.length);
    for (const [chave, item] of Object.entries(CATALOGO)) {
      expect(item.id).toBe(chave);
    }
  });

  it("nenhum preço negativo", () => {
    for (const item of ITENS) {
      expect(Number.isInteger(item.preco)).toBe(true);
      expect(item.preco).toBeGreaterThanOrEqual(0);
    }
  });

  it("todo slot existe no enum do banco", () => {
    const doBanco: readonly string[] = zenhaSlotEnum.enumValues;
    for (const item of ITENS) {
      if (item.slot !== null) expect(doBanco).toContain(item.slot);
    }
  });

  it("SlotDeExibicao é EXATAMENTE o enum do banco, nos dois sentidos", () => {
    // As duas atribuições são o teste: cada uma só compila se uma das inclusões
    // valer, e juntas cobram igualdade. O laço acima pega slot do catálogo que
    // o banco não tem; isto aqui pega o inverso — valor novo em `zenha_slot`
    // que ninguém acrescentou ao tipo, que é como um slot inteiro sumiria da
    // vitrine sem nada quebrar.
    const doBanco: SlotDeExibicao[] = [...zenhaSlotEnum.enumValues];
    const doCatalogo: ZenhaSlot[] = doBanco;
    expect(doCatalogo).toEqual(zenhaSlotEnum.enumValues);
  });

  it("só o multiplicador é consumível, e é o único sem slot", () => {
    const consumiveis = ITENS.filter((i) => i.consumivel).map((i) => i.id);
    const semSlot = ITENS.filter((i) => i.slot === null).map((i) => i.id);
    expect(consumiveis).toEqual([ID_DO_MULTIPLICADOR]);
    expect(semSlot).toEqual([ID_DO_MULTIPLICADOR]);
  });

  it("o preço do multiplicador é o ajuste da economia, não um número copiado", () => {
    expect(CATALOGO[ID_DO_MULTIPLICADOR].preco).toBe(AJUSTES.multiplicador_preco_base.padrao);
  });

  it("todo item tem nome e descrição escritos", () => {
    for (const item of ITENS) {
      expect(item.nome.trim().length).toBeGreaterThan(0);
      expect(item.descricao.trim().length).toBeGreaterThan(0);
    }
  });

  it("tokenId é ID de token, nunca classe do Tailwind", () => {
    // O bug que isto pega é o de team-colors.ts: classe montada no .tsx some do
    // CSS final, e o item sai sem cor nenhuma.
    for (const item of ITENS) {
      expect(item.tokenId).toMatch(/^zenha-[a-z]+$/);
    }
    // Conjunto pequeno e reaproveitado — cor nova nasce no globals.css primeiro.
    expect(new Set(ITENS.map((i) => i.tokenId)).size).toBeLessThanOrEqual(8);
  });
});

describe("ehIdDeItem", () => {
  it("reconhece todo id do catálogo e recusa o resto", () => {
    for (const id of IDS) expect(ehIdDeItem(id)).toBe(true);
    expect(ehIdDeItem("camisa-do-flamengo")).toBe(false);
    expect(ehIdDeItem("")).toBe(false);
    // Não pode cair no protótipo de Object: `hasOwn`, e não `in`.
    expect(ehIdDeItem("toString")).toBe(false);
  });
});

describe("chaves de preço", () => {
  it("round-trip para todo id do catálogo", () => {
    for (const id of IDS) {
      const chave = chaveDePreco(id);
      expect(chave).toBe(`preco:${id}`);
      expect(itemDaChaveDePreco(chave)).toBe(id);
    }
  });

  it("chave de ajuste comum não é chave de preço", () => {
    expect(itemDaChaveDePreco("participacao")).toBeNull();
    expect(itemDaChaveDePreco("multiplicador_preco_base")).toBeNull();
  });

  it("chave de preço de item que não existe é lixo, não chave", () => {
    expect(itemDaChaveDePreco("preco:item-que-nunca-existiu")).toBeNull();
    expect(itemDaChaveDePreco("preco:")).toBeNull();
  });

  it("o prefixo tem que estar no começo", () => {
    expect(itemDaChaveDePreco(`x-preco:${IDS[1]}`)).toBeNull();
  });
});

describe("precoVigente", () => {
  const id = "dono-da-bola" as IdDeItem;
  const padrao = CATALOGO[id].preco;

  it("sem sobrescrita, vale o padrão do catálogo", () => {
    expect(precoVigente(id, new Map())).toBe(padrao);
  });

  it("com sobrescrita válida, vale a sobrescrita", () => {
    expect(precoVigente(id, new Map([[chaveDePreco(id), 999]]))).toBe(999);
    // De graça é preço válido: item de campanha, ou item que o admin resolveu
    // dar para todo mundo.
    expect(precoVigente(id, new Map([[chaveDePreco(id), 0]]))).toBe(0);
  });

  it("sobrescrita quebrada é ignorada em vez de derrubar a loja", () => {
    for (const ruim of [-1, 12.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(precoVigente(id, new Map([[chaveDePreco(id), ruim]]))).toBe(padrao);
    }
  });

  it("a sobrescrita de um item não vaza para o outro", () => {
    const mapa = new Map([[chaveDePreco(id), 7]]);
    const outro = "perna-de-pau" as IdDeItem;
    expect(precoVigente(outro, mapa)).toBe(CATALOGO[outro].preco);
  });
});

describe("itensAVenda", () => {
  it("não devolve aposentado", () => {
    const aposentados = ITENS.filter((i) => i.aposentado).map((i) => i.id);
    const aVenda = itensAVenda().map((i) => i.id);
    for (const id of aposentados) expect(aVenda).not.toContain(id);
    expect(aVenda).toHaveLength(IDS.length - aposentados.length);
  });

  it("é estável entre chamadas — a vitrine não dança entre renders", () => {
    expect(itensAVenda().map((i) => i.id)).toEqual(itensAVenda().map((i) => i.id));
  });

  it("devolve um array novo, para ninguém reordenar a loja de todo mundo", () => {
    const antes = itensAVenda().map((i) => i.id);
    itensAVenda().sort((a, b) => a.id.localeCompare(b.id));
    expect(itensAVenda().map((i) => i.id)).toEqual(antes);
  });

  it("agrupa por slot e, dentro do slot, do mais barato ao mais caro", () => {
    const lista = itensAVenda();

    // Cada slot aparece num bloco só.
    const blocos = lista.map((i) => i.slot).filter((slot, i, todos) => slot !== todos[i - 1]);
    expect(new Set(blocos).size).toBe(blocos.length);

    // Dentro do bloco, preço nunca cai.
    for (let i = 1; i < lista.length; i++) {
      if (lista[i].slot === lista[i - 1].slot) {
        expect(lista[i].preco).toBeGreaterThanOrEqual(lista[i - 1].preco);
      }
    }
  });

  it("o consumível abre a vitrine", () => {
    expect(itensAVenda()[0].id).toBe(ID_DO_MULTIPLICADOR);
  });
});
