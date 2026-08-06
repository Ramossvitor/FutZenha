import { describe, expect, it } from "vitest";
import { avaliarVotacao, placar, votosNecessarios } from "./votacao";

describe("votosNecessarios", () => {
  it("arredonda para cima — meio voto não existe", () => {
    expect(votosNecessarios(10)).toBe(9); // 8,5 → 9
    expect(votosNecessarios(12)).toBe(11); // 10,2 → 11
    expect(votosNecessarios(20)).toBe(17); // exato
  });

  it("com poucos eleitores, exige unanimidade", () => {
    // Abaixo de 7 eleitores, 85% arredondado para cima é todo mundo.
    for (const n of [1, 2, 3, 4, 5, 6]) {
      expect(votosNecessarios(n)).toBe(n);
    }
    expect(votosNecessarios(7)).toBe(6);
  });

  it("eleitorado vazio não exige voto nenhum", () => {
    expect(votosNecessarios(0)).toBe(0);
  });
});

describe("placar", () => {
  it("conta pendentes como quem ainda não votou", () => {
    expect(placar(10, 3, 2)).toMatchObject({ pendentes: 5, necessarios: 9, faltam: 6 });
  });

  it("não deixa pendentes nem faltam ficarem negativos", () => {
    expect(placar(10, 9, 1)).toMatchObject({ pendentes: 0, faltam: 0 });
  });
});

describe("avaliarVotacao", () => {
  it("aprova ao atingir o quórum, mesmo antes do prazo", () => {
    expect(avaliarVotacao({ elegiveis: 10, sim: 9, nao: 1 }, false)).toBe("approved");
  });

  it("segue aberta enquanto ainda for possível aprovar", () => {
    // 10 eleitores, precisa de 9: com 5 sim e 0 nao, os 5 pendentes bastam.
    expect(avaliarVotacao({ elegiveis: 10, sim: 5, nao: 0 }, false)).toBe("open");
  });

  // Sem isso a votação ficaria de pé por 48h com o resultado já decidido.
  it("rejeita na hora quando o quórum virou impossível", () => {
    // 10 eleitores, precisa de 9. Com 2 NAO, no máximo 8 podem dizer sim.
    expect(avaliarVotacao({ elegiveis: 10, sim: 0, nao: 2 }, false)).toBe("rejected");
  });

  it("um NAO a mais que o limite já derruba", () => {
    // 20 eleitores, precisa de 17: 3 NAO ainda dá (17 possiveis), 4 nao da.
    expect(avaliarVotacao({ elegiveis: 20, sim: 0, nao: 3 }, false)).toBe("open");
    expect(avaliarVotacao({ elegiveis: 20, sim: 0, nao: 4 }, false)).toBe("rejected");
  });

  it("prazo vencido sem quórum rejeita — silêncio conta contra", () => {
    expect(avaliarVotacao({ elegiveis: 10, sim: 8, nao: 0 }, true)).toBe("rejected");
    expect(avaliarVotacao({ elegiveis: 10, sim: 8, nao: 0 }, false)).toBe("open");
  });

  it("prazo vencido com quórum atingido ainda aprova", () => {
    expect(avaliarVotacao({ elegiveis: 10, sim: 9, nao: 0 }, true)).toBe("approved");
  });

  it("ninguém votando e prazo vencido rejeita", () => {
    expect(avaliarVotacao({ elegiveis: 12, sim: 0, nao: 0 }, true)).toBe("rejected");
  });

  it("com 3 eleitores exige os 3", () => {
    expect(avaliarVotacao({ elegiveis: 3, sim: 2, nao: 0 }, false)).toBe("open");
    expect(avaliarVotacao({ elegiveis: 3, sim: 2, nao: 1 }, false)).toBe("rejected");
    expect(avaliarVotacao({ elegiveis: 3, sim: 3, nao: 0 }, false)).toBe("approved");
  });

  // Documenta uma armadilha, não um comportamento desejado: com eleitorado
  // vazio votosNecessarios dá 0, e 0 >= 0 aprova — apagaria a pelada sem
  // ninguém ter votado. Só não é caminho vivo porque abrirVotacao() intercepta
  // antes, devolvendo "sem-eleitores" (src/lib/deletion.ts). Se este teste um
  // dia falhar junto com aquele guard removido, a pelada some sozinha.
  it("eleitorado vazio aprovaria — quem barra é o guard de abrirVotacao", () => {
    expect(votosNecessarios(0)).toBe(0);
    expect(avaliarVotacao({ elegiveis: 0, sim: 0, nao: 0 }, false)).toBe("approved");
  });
});
