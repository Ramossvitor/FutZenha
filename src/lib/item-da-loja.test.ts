import { describe, expect, it } from "vitest";
// Os enums de VERDADE, e não os nomes repetidos aqui: schema.ts não é
// `server-only` e só importa drizzle, então o vitest unit alcança. É o que faz
// um tipo novo na migration sem lugar nas prateleiras quebrar este teste em vez
// de sumir da loja em silêncio.
import { lojaTipoEnum, zenhaSlotEnum, type LojaTipo } from "@/db/schema";
import {
  EFEITO_DO_MULTIPLICADOR,
  ORDEM_DAS_PRATELEIRAS,
  REGEX_DE_COR,
  VAGAS_NA_VITRINE,
  ehConsumivel,
  ehMultiplicador,
  ordenarParaVitrine,
  slotDoItem,
  urlDaImagemDoItem,
  type ItemDaLoja,
} from "./item-da-loja";

function item(extra: Partial<ItemDaLoja> & Pick<ItemDaLoja, "tipo">): ItemDaLoja {
  return {
    id: 1,
    nome: "Item",
    descricao: "",
    preco: 100,
    cor: null,
    imagemHash: null,
    efeito: null,
    ativo: true,
    ...extra,
  };
}

describe("as prateleiras", () => {
  it("todo tipo do enum tem posição, e nenhuma sobra", () => {
    expect(Object.keys(ORDEM_DAS_PRATELEIRAS).sort()).toEqual([...lojaTipoEnum.enumValues].sort());
  });

  it("as posições são distintas — duas prateleiras no mesmo lugar seriam ordem aleatória", () => {
    const posicoes = Object.values(ORDEM_DAS_PRATELEIRAS);
    expect(new Set(posicoes).size).toBe(posicoes.length);
  });

  it("o consumível abre a loja e o badge vem logo atrás", () => {
    // A regra escrita no módulo: o único item que mexe no jogo não pode ficar
    // enterrado embaixo dos cosméticos.
    expect(ORDEM_DAS_PRATELEIRAS.consumivel).toBeLessThan(ORDEM_DAS_PRATELEIRAS.badge);
    for (const tipo of ["moldura", "cor_do_nome", "titulo"] as const) {
      expect(ORDEM_DAS_PRATELEIRAS.badge).toBeLessThan(ORDEM_DAS_PRATELEIRAS[tipo]);
    }
  });
});

describe("slotDoItem", () => {
  it("moldura, cor do nome e título vão para o slot de mesmo nome", () => {
    for (const slot of zenhaSlotEnum.enumValues) {
      expect(slotDoItem(item({ tipo: slot }))).toBe(slot);
    }
  });

  it("badge não tem slot: ele é coleção, e slot é a promessa de que só cabe um", () => {
    expect(slotDoItem(item({ tipo: "badge" }))).toBeNull();
  });

  it("consumível não tem slot: ele se arma num fut, não se pendura no perfil", () => {
    expect(slotDoItem(item({ tipo: "consumivel" }))).toBeNull();
  });

  it("todo tipo do enum tem resposta — nenhum cai em undefined", () => {
    for (const tipo of lojaTipoEnum.enumValues) {
      expect(slotDoItem(item({ tipo }))).not.toBeUndefined();
    }
  });

  it("todo slot devolvido existe no enum do banco", () => {
    for (const tipo of lojaTipoEnum.enumValues) {
      const slot = slotDoItem(item({ tipo }));
      if (slot !== null) expect(zenhaSlotEnum.enumValues).toContain(slot);
    }
  });
});

describe("ehConsumivel / ehMultiplicador", () => {
  it("só o tipo consumível é consumível", () => {
    for (const tipo of lojaTipoEnum.enumValues) {
      expect(ehConsumivel(item({ tipo }))).toBe(tipo === "consumivel");
    }
  });

  it("é o efeito que identifica o multiplicador — não o nome, que o admin edita", () => {
    expect(ehMultiplicador(item({ tipo: "consumivel", efeito: EFEITO_DO_MULTIPLICADOR }))).toBe(
      true,
    );
    expect(ehMultiplicador(item({ tipo: "badge", nome: "Multiplicador de nota" }))).toBe(false);
  });
});

describe("urlDaImagemDoItem", () => {
  it("monta o caminho com id e hash", () => {
    expect(urlDaImagemDoItem({ id: 7, imagemHash: "a".repeat(32) })).toBe(
      `/imagens/loja/7/${"a".repeat(32)}`,
    );
  });

  it("sem hash não há URL — e é null, não uma URL quebrada", () => {
    expect(urlDaImagemDoItem({ id: 7, imagemHash: null })).toBeNull();
  });

  it("a URL não fica embaixo de nenhum prefixo que exige login", () => {
    // O destaque aparece em ranking e página de fut, que são públicos. Uma
    // imagem sob /loja ou /perfil seria redirecionada para o login pelo proxy e
    // o visitante deslogado veria a página com os badges quebrados.
    const url = urlDaImagemDoItem({ id: 1, imagemHash: "b".repeat(32) })!;
    expect(url.startsWith("/imagens/")).toBe(true);
  });
});

describe("ordenarParaVitrine", () => {
  const badgeCaro = item({ id: 1, tipo: "badge", preco: 900 });
  const badgeBarato = item({ id: 2, tipo: "badge", preco: 100 });
  const badgeEmpatado = item({ id: 3, tipo: "badge", preco: 100 });
  const consumivel = item({ id: 4, tipo: "consumivel", preco: 5000, efeito: "multiplicador" });
  const titulo = item({ id: 5, tipo: "titulo", preco: 1 });

  it("prateleira manda mais que preço", () => {
    // O consumível é o mais caro da lista e ainda assim abre; o título é o mais
    // barato e ainda assim fecha.
    const ordenados = ordenarParaVitrine([titulo, badgeCaro, consumivel]);
    expect(ordenados.map((i) => i.id)).toEqual([consumivel.id, badgeCaro.id, titulo.id]);
  });

  it("dentro da prateleira, do mais barato ao mais caro", () => {
    const ordenados = ordenarParaVitrine([badgeCaro, badgeBarato]);
    expect(ordenados.map((i) => i.id)).toEqual([badgeBarato.id, badgeCaro.id]);
  });

  it("empate de preço desempata pelo id, e não pelo humor do sort", () => {
    const ordenados = ordenarParaVitrine([badgeEmpatado, badgeBarato]);
    expect(ordenados.map((i) => i.id)).toEqual([badgeBarato.id, badgeEmpatado.id]);
  });

  it("a ordem é estável entre chamadas", () => {
    const entrada = [titulo, badgeEmpatado, consumivel, badgeBarato, badgeCaro];
    expect(ordenarParaVitrine(entrada)).toEqual(ordenarParaVitrine([...entrada].reverse()));
  });

  it("devolve array novo e não reordena o de quem chamou", () => {
    const entrada = [titulo, consumivel];
    const ordenados = ordenarParaVitrine(entrada);
    expect(ordenados).not.toBe(entrada);
    expect(entrada.map((i) => i.id)).toEqual([titulo.id, consumivel.id]);
  });
});

describe("constantes de produto", () => {
  it("a vitrine tem cinco vagas — o mesmo número do check do banco", () => {
    // O `check (posicao between 1 and 5)` da zenha_vitrine é o par deste
    // número. Mudar um sem o outro faz a tela oferecer uma vaga que o banco
    // recusa (ou esconder uma que ele aceita).
    expect(VAGAS_NA_VITRINE).toBe(5);
  });

  it("a regex de cor aceita hex minúsculo de seis dígitos e nada mais", () => {
    expect(REGEX_DE_COR.test("#0a1b2c")).toBe(true);
    expect(REGEX_DE_COR.test("#000000")).toBe(true);
    // Maiúscula não passa: a normalização é da escrita, e o check do banco
    // carrega a mesma exigência — aceitar aqui gravaria duas formas da mesma cor.
    expect(REGEX_DE_COR.test("#0A1B2C")).toBe(false);
    expect(REGEX_DE_COR.test("#abc")).toBe(false);
    expect(REGEX_DE_COR.test("0a1b2c")).toBe(false);
    expect(REGEX_DE_COR.test("#0a1b2cc")).toBe(false);
    expect(REGEX_DE_COR.test("javascript:alert(1)")).toBe(false);
  });

  it("o efeito conhecido é um só, e o tipo o acompanha", () => {
    const efeito: LojaTipo = "consumivel";
    expect(EFEITO_DO_MULTIPLICADOR).toBe("multiplicador");
    expect(lojaTipoEnum.enumValues).toContain(efeito);
  });
});
