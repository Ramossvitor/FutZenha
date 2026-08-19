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
  endTime: "22:00",
  location: "Quadra do Zé",
  notes: "Levar colete",
  maxPlayers: "14",
};

describe("parseMatchDayForm", () => {
  it("aceita um fut bem preenchida", () => {
    const r = parseMatchDayForm(form(valida));
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.date).toBe("2026-08-12");
      expect(r.data.location).toBe("Quadra do Zé");
      expect(r.data.maxPlayers).toBe(14);
    }
  });

  // Vazio = sem limite, o padrão de todo fut anterior à lista de espera. Só
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
    const r = parseMatchDayForm(form({ ...valida, startTime: "", endTime: "", notes: "" }));
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.startTime).toBeNull();
      expect(r.data.endTime).toBeNull();
      expect(r.data.notes).toBeNull();
    }
  });

  // O término vai para a agenda de todo mundo que confirmou, e quem administra o
  // fut reescreve o bloco dessa gente. O teto é o que impede "das 8h de sexta às
  // 22h de domingo" — o mesmo limite que o match_days_duracao_check aplica no
  // banco, aqui só com mensagem.
  it("aceita duração até 6h, inclusive virando a meia-noite", () => {
    for (const [startTime, endTime] of [
      ["20:00", "20:30"], // piso: 30min
      ["20:00", "02:00"], // teto: 6h, virando o dia
      ["22:00", "00:30"], // fut de sexta que acaba no sábado
    ]) {
      const r = parseMatchDayForm(form({ ...valida, startTime, endTime }));
      expect(r.success).toBe(true);
    }
  });

  it("recusa duração absurda, curta demais ou igual ao início", () => {
    for (const [startTime, endTime] of [
      ["08:00", "23:00"], // 15h: tomaria o dia de quem confirmou
      ["20:00", "20:10"], // 10min: fim digitado errado
      ["20:00", "20:00"], // igual ao início não é fut de 24h
      ["20:00", "19:59"], // 23h59 pela virada — o caso que o teto tem que pegar
    ]) {
      expect(parseMatchDayForm(form({ ...valida, startTime, endTime })).success).toBe(false);
    }
  });

  it("recusa término sem horário de início", () => {
    const r = parseMatchDayForm(form({ ...valida, startTime: "", endTime: "22:00" }));
    expect(r.success).toBe(false);
  });
});
