import { describe, expect, it } from "vitest";
import { parseEmailDeContato, parseEmailDeContatoOpcional } from "./email-contato";

describe("parseEmailDeContato", () => {
  it("normaliza espaço e maiúsculas", () => {
    expect(parseEmailDeContato("  Vitor.Ramos@Gmail.COM ")).toEqual({
      ok: true,
      email: "vitor.ramos@gmail.com",
    });
  });

  // Guarda o endereço como veio (só em minúsculas), não a forma canônica: é o
  // que a pessoa reconhece na tela, e canonicalizar serve para comparar, não
  // para gravar (ver src/lib/email.ts).
  it("não reduz as variantes do Gmail", () => {
    expect(parseEmailDeContato("vitor.ramos+fut@gmail.com")).toEqual({
      ok: true,
      email: "vitor.ramos+fut@gmail.com",
    });
  });

  it("recusa vazio, porque o cadastro exige endereço", () => {
    expect(parseEmailDeContato("")).toEqual({ ok: false, erro: "Informe seu e-mail." });
    expect(parseEmailDeContato("   ")).toEqual({ ok: false, erro: "Informe seu e-mail." });
    expect(parseEmailDeContato(null)).toEqual({ ok: false, erro: "Informe seu e-mail." });
  });

  it("recusa endereço inválido com mensagem de conferir", () => {
    const resultado = parseEmailDeContato("sem-arroba");
    expect(resultado.ok).toBe(false);
    expect(resultado).toHaveProperty("erro", "E-mail inválido — confira o endereço.");
  });

  it("recusa endereço longo demais", () => {
    const longo = `${"a".repeat(160)}@example.com`;
    expect(parseEmailDeContato(longo)).toEqual({ ok: false, erro: "E-mail longo demais." });
  });
});

describe("parseEmailDeContatoOpcional", () => {
  // A diferença entre as duas funções é só esta, e é ela que deixa o admin
  // apagar um endereço digitado errado sem precisar de outro botão.
  it("aceita vazio como 'apagar o que havia'", () => {
    expect(parseEmailDeContatoOpcional("")).toEqual({ ok: true, email: null });
    expect(parseEmailDeContatoOpcional(null)).toEqual({ ok: true, email: null });
  });

  it("valida igual quando vem preenchido", () => {
    expect(parseEmailDeContatoOpcional(" Fulano@Example.com ")).toEqual({
      ok: true,
      email: "fulano@example.com",
    });
    expect(parseEmailDeContatoOpcional("sem-arroba").ok).toBe(false);
  });
});
