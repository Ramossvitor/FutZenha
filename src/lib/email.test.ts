import { describe, expect, it } from "vitest";
import { canonicalizarEmail, mesmoEmail } from "./email";

describe("canonicalizarEmail", () => {
  it("no Gmail, ignora ponto e etiqueta", () => {
    expect(canonicalizarEmail("vitor.ramos@gmail.com")).toBe("vitorramos@gmail.com");
    expect(canonicalizarEmail("vitorramos+pelada@gmail.com")).toBe("vitorramos@gmail.com");
    expect(canonicalizarEmail("v.i.t.o.r+a.b@googlemail.com")).toBe("vitor@googlemail.com");
  });

  it("normaliza espaço e maiúsculas em qualquer domínio", () => {
    expect(canonicalizarEmail("  Vitor.Ramos@Gmail.com ")).toBe("vitorramos@gmail.com");
    expect(canonicalizarEmail("Vitor.Ramos@Empresa.com")).toBe("vitor.ramos@empresa.com");
  });

  // A regra do ponto é do Gmail, não de e-mail em geral: há provedor em que
  // "a.b@" e "ab@" são duas pessoas diferentes.
  it("fora do Gmail, preserva ponto e etiqueta", () => {
    expect(canonicalizarEmail("vitor.ramos@outlook.com")).toBe("vitor.ramos@outlook.com");
    expect(canonicalizarEmail("vitor+pelada@empresa.com.br")).toBe("vitor+pelada@empresa.com.br");
  });

  it("não inventa canônico para entrada sem domínio", () => {
    expect(canonicalizarEmail("sem-arroba")).toBe("sem-arroba");
    expect(canonicalizarEmail("@gmail.com")).toBe("@gmail.com");
  });

  // Se o local part sumisse, endereços diferentes colidiriam — e colidir aqui é
  // deixar um convite ser resgatado por outra conta.
  it("local part que zeraria não é reduzido", () => {
    expect(canonicalizarEmail("...@gmail.com")).toBe("...@gmail.com");
    expect(canonicalizarEmail("+tag@gmail.com")).toBe("+tag@gmail.com");
  });
});

describe("mesmoEmail", () => {
  it("reconhece as variantes do Gmail", () => {
    expect(mesmoEmail("vitor.ramos@gmail.com", "vitorramos@gmail.com")).toBe(true);
    expect(mesmoEmail("Vitor.Ramos@GMAIL.com", "vitorramos+pelada@gmail.com")).toBe(true);
  });

  it("não confunde pessoas diferentes", () => {
    expect(mesmoEmail("vitor@gmail.com", "vitor2@gmail.com")).toBe(false);
    expect(mesmoEmail("vitor@gmail.com", "vitor@empresa.com")).toBe(false);
    expect(mesmoEmail("vitor.ramos@outlook.com", "vitorramos@outlook.com")).toBe(false);
  });
});
