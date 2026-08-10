import { describe, expect, it } from "vitest";
import { parseMatchDayForm } from "./match-day-form";

function form(campos: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) fd.set(k, v);
  return fd;
}

const valida = {
  date: "2026-08-12",
  startTime: "20:00",
  location: "Quadra do Zé",
  notes: "Levar colete",
  maxPlayers: "14",
};

describe("parseMatchDayForm", () => {
  it("aceita uma pelada bem preenchida", () => {
    const r = parseMatchDayForm(form(valida));
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.date).toBe("2026-08-12");
      expect(r.data.location).toBe("Quadra do Zé");
      expect(r.data.maxPlayers).toBe(14);
    }
  });

  // Vazio = sem limite, o padrão de toda pelada anterior à lista de espera. Só
  // espaços cai no mesmo caso: o trim roda antes da conversão — sem ele,
  // Number("   ") daria 0 e a validação recusaria o formulário intocado.
  it("vagas vazias ou só com espaços viram null, não zero", () => {
    for (const maxPlayers of ["", "   "]) {
      const r = parseMatchDayForm(form({ ...valida, maxPlayers }));
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.maxPlayers).toBeNull();
    }
  });

  it("aceita as bordas do limite: 2 e 60", () => {
    for (const [maxPlayers, esperado] of [
      ["2", 2],
      ["60", 60],
    ] as const) {
      const r = parseMatchDayForm(form({ ...valida, maxPlayers }));
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.maxPlayers).toBe(esperado);
    }
  });

  // Abaixo de 2 não há sorteio possível; acima de 60 é porta de número absurdo;
  // fração e texto não são inteiros — o refine barra os quatro de uma vez.
  it("recusa 1, 61, fração e texto", () => {
    for (const maxPlayers of ["1", "61", "2.5", "abc"]) {
      expect(parseMatchDayForm(form({ ...valida, maxPlayers })).success).toBe(false);
    }
  });

  // null, e não "": é o que deixa as colunas opcionais de verdade no banco —
  // string vazia num `time` do Postgres seria erro de insert.
  it("horário e observações vazios viram null, não string vazia", () => {
    const r = parseMatchDayForm(form({ ...valida, startTime: "", notes: "" }));
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.startTime).toBeNull();
      expect(r.data.notes).toBeNull();
    }
  });
});
