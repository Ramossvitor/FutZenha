import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// O projeto unit roda em Node e não renderiza .tsx (ver linha-de-campos.test.ts);
// o que cabe aqui é a trava no FONTE do chip e do globals.css, ao lado do chip.
const ler = (caminho: string) =>
  readFileSync(fileURLToPath(new URL(caminho, import.meta.url)), "utf8");

describe("a regra da classe literal", () => {
  // O Tailwind varre o código-fonte: uma classe montada com a cor interpolada
  // nunca existiria no CSS final e o chip sairia sem cor. A cor entra por
  // custom property, e a classe que a lê é literal — nos DOIS arquivos.
  it("o chip usa a classe `colete-livre` que o globals.css define, com a cor por custom property", () => {
    // Sem os comentários: eles citam o anti-padrão de propósito, para explicá-lo.
    const chip = ler("./vest.tsx")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    const css = ler("../../app/globals.css");
    expect(chip).toContain('"colete-livre"');
    expect(chip).toContain("--cor-do-colete");
    expect(chip).not.toMatch(/(?:bg|border)-\[\$\{/);
    expect(css).toMatch(/@utility colete-livre\b/);
    expect(css).toContain("color-mix(in srgb, var(--cor-do-colete)");
  });
});
