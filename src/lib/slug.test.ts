import { describe, expect, it } from "vitest";
import {
  ehSlug,
  primeiroLivre,
  slugBase,
  slugificar,
  SLUG_MAX,
  SLUG_REGEX,
  troncoDeColisao,
  variacaoDeSlug,
} from "./slug";

describe("slugificar", () => {
  it("usa o nome inteiro, com hífen no lugar do espaço", () => {
    expect(slugificar("Vitor Ramos")).toBe("vitor-ramos");
  });

  it("tira acento e o que não couber no charset", () => {
    expect(slugificar("José Antônio")).toBe("jose-antonio");
    expect(slugificar("Zé Ruela!")).toBe("ze-ruela");
    expect(slugificar("Ação & Cia.")).toBe("acao-cia");
  });

  it("colapsa separador repetido e limpa as pontas", () => {
    expect(slugificar("  Vitor   Ramos  ")).toBe("vitor-ramos");
    expect(slugificar("--vitor--ramos--")).toBe("vitor-ramos");
    expect(slugificar("...vitor...")).toBe("vitor");
  });

  it("trunca em 60 caracteres sem deixar ponta suja", () => {
    const gerado = slugificar(`${"a".repeat(58)} bcdef`);
    expect(gerado).toHaveLength(SLUG_MAX);
    expect(gerado.endsWith("-")).toBe(false);
    // O corte caiu exatamente no hífen: aparar de novo o removeu.
    expect(slugificar(`${"a".repeat(59)} b`)).toBe("a".repeat(59));
  });

  it("pode sair vazia ou só com dígitos — quem garante é o slugBase", () => {
    expect(slugificar("李")).toBe("");
    expect(slugificar("")).toBe("");
    expect(slugificar("2024")).toBe("2024");
  });
});

describe("slugBase", () => {
  it("devolve a normalização quando ela já serve", () => {
    expect(slugBase("Vitor Ramos", "jogador")).toBe("vitor-ramos");
  });

  // A regra que sustenta o 404 das URLs antigas: nenhum slug é só dígitos.
  it("qualifica o que sairia puramente numérico", () => {
    expect(slugBase("2024", "grupo")).toBe("grupo-2024");
    expect(slugBase("7", "jogador")).toBe("jogador-7");
  });

  it("cai no prefixo quando não sobra nada utilizável", () => {
    expect(slugBase("李", "jogador")).toBe("jogador");
    expect(slugBase("", "jogador")).toBe("jogador");
    expect(slugBase("!!!", "grupo")).toBe("grupo");
  });

  // Um caractere reprova no mínimo do regex, mas ainda é pista do nome: entra
  // como qualificador em vez de ser jogado fora.
  it("preserva o pouco que sobrou em vez de descartá-lo", () => {
    expect(slugBase("Á", "jogador")).toBe("jogador-a");
  });

  it("o que sai sempre passa no SLUG_REGEX e nunca é só dígitos", () => {
    for (const texto of ["Vitor Ramos", "José Antônio", "李", "", "2024", "!!!", "Á", "a".repeat(80)]) {
      const gerado = slugBase(texto, "jogador");
      expect(gerado).toMatch(SLUG_REGEX);
      expect(ehSlug(gerado)).toBe(true);
    }
  });
});

describe("variacaoDeSlug", () => {
  it("a primeira tentativa é a base intacta", () => {
    expect(variacaoDeSlug("vitor-ramos", 1)).toBe("vitor-ramos");
  });

  it("numera a partir da segunda", () => {
    expect(variacaoDeSlug("vitor-ramos", 2)).toBe("vitor-ramos-2");
    expect(variacaoDeSlug("vitor-ramos", 3)).toBe("vitor-ramos-3");
  });

  it("não estoura o limite quando a base já está cheia", () => {
    const base = "a".repeat(SLUG_MAX);
    for (const tentativa of [2, 9, 10, 99]) {
      const gerado = variacaoDeSlug(base, tentativa);
      expect(gerado.length).toBeLessThanOrEqual(SLUG_MAX);
      expect(gerado).toMatch(SLUG_REGEX);
      expect(gerado.endsWith(`-${tentativa}`)).toBe(true);
    }
  });

  it("não deixa separador dobrado quando o corte cai num hífen", () => {
    const base = `${"a".repeat(57)}-bb`;
    expect(base).toHaveLength(SLUG_MAX);
    expect(variacaoDeSlug(base, 2)).toBe(`${"a".repeat(57)}-2`);
  });
});

describe("primeiroLivre", () => {
  it("devolve a base quando ela está livre", () => {
    expect(primeiroLivre("vitor-ramos", new Set())).toBe("vitor-ramos");
  });

  it("pula os ocupados na ordem das variações", () => {
    const ocupados = new Set(["vitor-ramos", "vitor-ramos-2"]);
    expect(primeiroLivre("vitor-ramos", ocupados)).toBe("vitor-ramos-3");
  });

  it("sai do lugar mesmo quando a base cheia obriga a truncar", () => {
    const base = "a".repeat(SLUG_MAX);
    const ocupados = new Set([base, variacaoDeSlug(base, 2)]);
    expect(primeiroLivre(base, ocupados)).toBe(variacaoDeSlug(base, 3));
  });
});

describe("troncoDeColisao", () => {
  it("é a própria base quando ela é curta", () => {
    expect(troncoDeColisao("vitor-ramos")).toBe("vitor-ramos");
  });

  // A razão de existir: a variação de uma base cheia é truncada e NÃO começa
  // com `base-` — quem busca ocupados por esse prefixo não a enxerga. Toda
  // variação, truncada ou não, começa com o tronco.
  it("base e toda variação começam com o tronco", () => {
    for (const base of ["a".repeat(SLUG_MAX), "a".repeat(59), `${"a".repeat(57)}-bb`, "vitor"]) {
      const tronco = troncoDeColisao(base);
      expect(base.startsWith(tronco)).toBe(true);
      for (const tentativa of [2, 9, 10, 99, 999]) {
        expect(variacaoDeSlug(base, tentativa).startsWith(tronco)).toBe(true);
      }
    }
  });
});

describe("ehSlug", () => {
  it("aceita o que este módulo gera", () => {
    expect(ehSlug("vitor-ramos")).toBe(true);
    expect(ehSlug("joao.silva")).toBe(true);
    expect(ehSlug("fut_da_firma")).toBe(true);
  });

  // O coração da mudança: a URL antiga não chega ao banco, dá 404 no guard.
  it("recusa id numérico, que é a URL antiga", () => {
    expect(ehSlug("1")).toBe(false);
    expect(ehSlug("17")).toBe(false);
    expect(ehSlug("0042")).toBe(false);
  });

  it("recusa o que não é slug", () => {
    expect(ehSlug("")).toBe(false);
    expect(ehSlug("a")).toBe(false);
    expect(ehSlug("Vitor")).toBe(false);
    expect(ehSlug("vitor ramos")).toBe(false);
    expect(ehSlug("vitor/ramos")).toBe(false);
    expect(ehSlug("a".repeat(SLUG_MAX + 1))).toBe(false);
  });
});
