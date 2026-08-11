import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { colete, defaultTeamNames, varDoColete } from "./team-colors";

describe("colete", () => {
  it("dá preenchimento e borda para cada cor do sorteio", () => {
    for (const nome of defaultTeamNames) {
      const classes = colete(nome);
      expect(classes).toMatch(/^bg-vest-[a-z]+ border-vest-[a-z]+-line$/);
    }
  });

  it("é indiferente a caixa e a espaço — teams.name é TEXT livre", () => {
    expect(colete("preto")).toBe(colete("Preto"));
    expect(colete("  VERDE  ")).toBe(colete("Verde"));
  });

  it("cai num fallback visível quando o nome não é cor conhecida", () => {
    // o admin pode ter criado um "Roxo" ou um "Time A" — não pode sumir da tela
    expect(colete("Roxo")).toBe("bg-surface-2 border-line-strong");
    expect(colete("Time A")).toBe("bg-surface-2 border-line-strong");
    expect(colete("")).toBe("bg-surface-2 border-line-strong");
  });

  it("sempre traz a borda junto do preenchimento", () => {
    // sem a borda, o colete Preto some no tema escuro (1,04:1) e o Branco
    // some no claro — a borda é o que garante os 3:1 contra a superfície
    for (const nome of [...defaultTeamNames, "Amarelo"]) {
      expect(colete(nome)).toContain("border-vest-");
    }
  });

  it("não monta classe por interpolação, senão o Tailwind não a gera", () => {
    // O Tailwind varre o código-fonte: uma classe montada com interpolação
    // nunca existiria no CSS final e o chip sairia sem cor. Este teste trava a
    // regra no arquivo — inclusive contra um "só desta vez" futuro.
    const fonte = readFileSync(fileURLToPath(new URL("./team-colors.ts", import.meta.url)), "utf8");
    // sem os comentários: eles citam o anti-padrão de propósito, para explicá-lo
    const codigo = fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(codigo).not.toMatch(/vest-\$\{/);
    expect(codigo).toContain("bg-vest-preto border-vest-preto-line");
  });
});

describe("varDoColete", () => {
  it("dá a variável CSS de cada cor do sorteio", () => {
    for (const nome of [...defaultTeamNames, "Amarelo"]) {
      expect(varDoColete(nome)).toBe(`--vest-${nome.toLowerCase()}`);
    }
  });

  it("é indiferente a caixa e a espaço, como o colete()", () => {
    expect(varDoColete("  AZUL ")).toBe("--vest-azul");
  });

  it("devolve null para nome inventado — confete não pode mentir sobre a cor", () => {
    // O chip de um "Roxo" sai cinza de desconhecido; o confete dele tem que
    // simplesmente não existir, e não cair numa cor de reserva.
    expect(varDoColete("Roxo")).toBeNull();
    expect(varDoColete("Time A")).toBeNull();
    expect(varDoColete("")).toBeNull();
  });
});
