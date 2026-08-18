import { describe, expect, it } from "vitest";
import { formatMeias, rotuloDeEstrelas } from "./format";

describe("formatMeias", () => {
  it("mostra a meia só quando existe", () => {
    expect(formatMeias(7)).toBe("3,5");
    expect(formatMeias(8)).toBe("4");
    expect(formatMeias(1)).toBe("0,5");
    expect(formatMeias(10)).toBe("5");
  });
});

describe("rotuloDeEstrelas", () => {
  // É o title/aria de tudo que mostra estrela e o seletor do E2E — a fronteira
  // do singular fica em 1 estrela: até uma é "estrela", de 1,5 em diante muda.
  it("singular até 1 estrela, plural dali em diante", () => {
    expect(rotuloDeEstrelas(1)).toBe("0,5 estrela");
    expect(rotuloDeEstrelas(2)).toBe("1 estrela");
    expect(rotuloDeEstrelas(3)).toBe("1,5 estrelas");
    expect(rotuloDeEstrelas(10)).toBe("5 estrelas");
  });
});
