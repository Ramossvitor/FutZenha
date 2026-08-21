import type { TokenDeItem } from "@/lib/loja-catalogo";

// O encontro entre o catálogo, que guarda só o ID do token, e o CSS, que tem a
// cor. Irmão do COLETE em src/lib/team-colors.ts, e pela mesma razão dura: o
// Tailwind gera utilitário VARRENDO O FONTE, então `text-${item.tokenId}` nunca
// existiria na folha final — o selo sairia sem cor nenhuma, sem erro nenhum, e
// só olhando a tela alguém perceberia.
//
// Daí as quatro strings literais por token, mesmo sendo as quatro o mesmo nome
// com prefixos diferentes.

/**
 * As quatro formas de vestir um token de item.
 *
 * Um objeto por token, e não quatro Records paralelos: são as quatro faces da
 * MESMA cor, e tabelas separadas divergem no dia em que alguém acrescentar um
 * token e parar na primeira. Aqui a entrada nasce inteira ou não compila.
 */
export type ClassesDoToken = {
  /** Tinta: texto do selo e cor do nome comprada. */
  texto: string;
  /** A borda do selo, que é a mesma cor rebaixada — ver o Selo. */
  borda: string;
  /** Preenchimento do losango do selo. */
  fundo: string;
  /** O anel da moldura do avatar. */
  anel: string;
};

/**
 * `Record<TokenDeItem, …>` fechado de propósito: token novo no catálogo sem cor
 * aqui não compila. A alternativa — um fallback cinza para o desconhecido —
 * entregaria a loja com um item que a pessoa pagou e veio sem cor, que é o
 * defeito mais caro possível num produto que vende cosmético.
 */
export const CLASSES_DO_TOKEN: Readonly<Record<TokenDeItem, ClassesDoToken>> = {
  "zenha-grama": {
    texto: "text-zenha-grama",
    borda: "border-zenha-grama/40",
    fundo: "bg-zenha-grama",
    anel: "ring-zenha-grama",
  },
  "zenha-cal": {
    texto: "text-zenha-cal",
    borda: "border-zenha-cal/40",
    fundo: "bg-zenha-cal",
    anel: "ring-zenha-cal",
  },
  "zenha-brasa": {
    texto: "text-zenha-brasa",
    borda: "border-zenha-brasa/40",
    fundo: "bg-zenha-brasa",
    anel: "ring-zenha-brasa",
  },
  "zenha-ouro": {
    texto: "text-zenha-ouro",
    borda: "border-zenha-ouro/40",
    fundo: "bg-zenha-ouro",
    anel: "ring-zenha-ouro",
  },
  "zenha-ceu": {
    texto: "text-zenha-ceu",
    borda: "border-zenha-ceu/40",
    fundo: "bg-zenha-ceu",
    anel: "ring-zenha-ceu",
  },
  "zenha-uva": {
    texto: "text-zenha-uva",
    borda: "border-zenha-uva/40",
    fundo: "bg-zenha-uva",
    anel: "ring-zenha-uva",
  },
  "zenha-carvao": {
    texto: "text-zenha-carvao",
    borda: "border-zenha-carvao/40",
    fundo: "bg-zenha-carvao",
    anel: "ring-zenha-carvao",
  },
};

/** Os tokens que existem, para quem precisa varrê-los (hoje só o teste). */
export const TOKENS_DE_ITEM = Object.keys(CLASSES_DO_TOKEN) as TokenDeItem[];
