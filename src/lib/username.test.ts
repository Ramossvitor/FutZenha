import { describe, expect, it } from "vitest";
import { sugerirUsername, USERNAME_MAX, USERNAME_REGEX, variacaoDeUsername } from "./username";

describe("sugerirUsername", () => {
  it("prefere o apelido ao nome", () => {
    expect(sugerirUsername("Vitor Ramos", "Du")).toBe("du");
  });

  it("sem apelido, usa o primeiro nome", () => {
    expect(sugerirUsername("Vitor Ramos", null)).toBe("vitor");
  });

  it("tira acento e o que não couber no regex", () => {
    expect(sugerirUsername("José Antônio", null)).toBe("jose");
    expect(sugerirUsername("Ramos", "Zé Ruela!")).toBe("zeruela");
  });

  it("trunca em 20 caracteres", () => {
    const gerado = sugerirUsername("Joaquim", "abcdefghijklmnopqrstuvwxyz");
    expect(gerado).toHaveLength(USERNAME_MAX);
  });

  // Conta criada pelo Google não passa por formulário: não há ninguém para
  // corrigir a sugestão, então ela precisa sair válida sempre.
  it("cai no fallback quando sobra menos de dois caracteres", () => {
    // "Zé" sobrevive: NFD tira o acento e restam dois. Um caractere só, ou
    // nenhum, é que reprova no mínimo do regex.
    expect(sugerirUsername("Zé", null)).toBe("ze");
    expect(sugerirUsername("Ávila", "Á")).toBe("jogador");
    expect(sugerirUsername("李", null)).toBe("jogador");
    expect(sugerirUsername("", null)).toBe("jogador");
    expect(sugerirUsername("!!!", null)).toBe("jogador");
  });

  it("o que sai sempre passa no USERNAME_REGEX", () => {
    for (const [nome, apelido] of [
      ["Vitor Ramos", null],
      ["José Antônio", "Zé"],
      ["李", null],
      ["", ""],
      ["A B C", "..."],
    ] as const) {
      expect(sugerirUsername(nome, apelido)).toMatch(USERNAME_REGEX);
    }
  });
});

describe("variacaoDeUsername", () => {
  it("a primeira tentativa é a base intacta", () => {
    expect(variacaoDeUsername("vitor", 1)).toBe("vitor");
  });

  it("numera a partir da segunda", () => {
    expect(variacaoDeUsername("vitor", 2)).toBe("vitor2");
    expect(variacaoDeUsername("vitor", 3)).toBe("vitor3");
  });

  // O sufixo come o fim da base: 21 caracteres seriam recusados pelo regex que
  // esta função existe justamente para satisfazer.
  it("não estoura o limite quando a base já está cheia", () => {
    const base = "abcdefghijklmnopqrst";
    expect(base).toHaveLength(USERNAME_MAX);
    for (const tentativa of [2, 9, 10, 99]) {
      const gerado = variacaoDeUsername(base, tentativa);
      expect(gerado).toHaveLength(USERNAME_MAX);
      expect(gerado).toMatch(USERNAME_REGEX);
      expect(gerado.endsWith(String(tentativa))).toBe(true);
    }
  });
});
