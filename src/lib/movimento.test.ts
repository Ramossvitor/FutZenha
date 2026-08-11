import { describe, expect, it } from "vitest";
import { parseMovimento } from "./movimento";

describe("parseMovimento", () => {
  it("aceita os três valores do domínio", () => {
    expect(parseMovimento("auto")).toBe("auto");
    expect(parseMovimento("ligado")).toBe("ligado");
    expect(parseMovimento("reduzido")).toBe("reduzido");
  });

  it("cai em auto sem cookie", () => {
    expect(parseMovimento(undefined)).toBe("auto");
  });

  it("cai em auto com cookie sujo, que é editável no DevTools", () => {
    expect(parseMovimento("")).toBe("auto");
    expect(parseMovimento("true")).toBe("auto");
    expect(parseMovimento("Ligado")).toBe("auto");
    expect(parseMovimento("reduzido; sujeira")).toBe("auto");
  });
});
