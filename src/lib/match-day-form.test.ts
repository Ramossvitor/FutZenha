import { describe, expect, it } from "vitest";
import {
  MAX_DIAS_FUTUROS_DO_FUT,
  MAX_DIAS_RETROATIVOS_DO_FUT,
  hojeNoFusoDoFut,
  parseMatchDayForm,
} from "./match-day-form";

function form(campos: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) fd.set(k, v);
  return fd;
}

// O "hoje" entra cravado em todo caso: a validação de data compara com ele, e
// um teste que dependesse do relógio da máquina passaria hoje e quebraria
// sozinho na semana que vem — que é exatamente o que aconteceu quando o limite
// de data retroativa entrou.
const HOJE = "2026-08-12";

const valida = {
  date: "2026-08-12",
  startTime: "20:00",
  endTime: "22:00",
  location: "Quadra do Zé",
  notes: "Levar colete",
  maxPlayers: "14",
};

const parse = (campos: Record<string, string>, hoje = HOJE) =>
  parseMatchDayForm(form(campos), { hoje });

describe("parseMatchDayForm", () => {
  it("aceita um fut bem preenchida", () => {
    const r = parse(valida);
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
      const r = parse({ ...valida, maxPlayers });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.maxPlayers).toBeNull();
    }
  });

  it("aceita as bordas do limite: 2 e 60", () => {
    for (const [maxPlayers, esperado] of [
      ["2", 2],
      ["60", 60],
    ] as const) {
      const r = parse({ ...valida, maxPlayers });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.maxPlayers).toBe(esperado);
    }
  });

  // Abaixo de 2 não há sorteio possível; acima de 60 é porta de número absurdo;
  // fração e texto não são inteiros — o refine barra os quatro de uma vez.
  it("recusa 1, 61, fração e texto", () => {
    for (const maxPlayers of ["1", "61", "2.5", "abc"]) {
      expect(parse({ ...valida, maxPlayers }).success).toBe(false);
    }
  });

  // null, e não "": é o que deixa as colunas opcionais de verdade no banco —
  // string vazia num `time` do Postgres seria erro de insert.
  it("horário e observações vazios viram null, não string vazia", () => {
    const r = parse({ ...valida, startTime: "", endTime: "", notes: "" });
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
      expect(parse({ ...valida, startTime, endTime }).success).toBe(true);
    }
  });

  it("recusa duração absurda, curta demais ou igual ao início", () => {
    for (const [startTime, endTime] of [
      ["08:00", "23:00"], // 15h: tomaria o dia de quem confirmou
      ["20:00", "20:10"], // 10min: fim digitado errado
      ["20:00", "20:00"], // igual ao início não é fut de 24h
      ["20:00", "19:59"], // 23h59 pela virada — o caso que o teto tem que pegar
    ]) {
      expect(parse({ ...valida, startTime, endTime }).success).toBe(false);
    }
  });

  it("recusa término sem horário de início", () => {
    expect(parse({ ...valida, startTime: "", endTime: "22:00" }).success).toBe(false);
  });

  // A ordem dos futs é a ordem do replay da nota e da sequência de presenças.
  // Sem estes dois limites, marcar um fut no passado remoto reescreve as duas
  // contas de uma vez.
  describe("limites de data", () => {
    it(`aceita exatamente ${MAX_DIAS_RETROATIVOS_DO_FUT} dias no passado e recusa um a mais`, () => {
      expect(parse({ ...valida, date: "2026-08-05" }).success).toBe(true);
      expect(parse({ ...valida, date: "2026-08-04" }).success).toBe(false);
    });

    it(`aceita exatamente ${MAX_DIAS_FUTUROS_DO_FUT} dias à frente e recusa um a mais`, () => {
      expect(parse({ ...valida, date: "2027-08-12" }).success).toBe(true);
      expect(parse({ ...valida, date: "2027-08-13" }).success).toBe(false);
    });

    // A virada do mês e do ano é onde uma conta de dias feita na mão erra.
    it("conta os dias atravessando mês e ano", () => {
      expect(parse({ ...valida, date: "2025-12-28" }, "2026-01-02").success).toBe(true);
      expect(parse({ ...valida, date: "2025-12-25" }, "2026-01-02").success).toBe(false);
    });

    // O horário de verão encurta ou alonga um dia; comparar ao meio-dia UTC é o
    // que impede a diferença de virar "um dia a mais" numa das bordas.
    it("não escorrega na borda por causa de fuso", () => {
      for (const dia of ["2026-02-14", "2026-10-17", "2026-11-01"]) {
        const seteAtras = new Date(Date.parse(`${dia}T12:00:00Z`) - 7 * 86_400_000)
          .toISOString()
          .slice(0, 10);
        expect(parse({ ...valida, date: seteAtras }, dia).success).toBe(true);
      }
    });

    // O limite existe para impedir REMARCAR o fut para o passado, não para
    // impedir editar um fut antigo. Sem esta dispensa, corrigir o local de um
    // fut de mês passado voltaria "dados inválidos" — e o formulário sempre
    // devolve a data junto, mesmo quando ninguém a tocou.
    it("dispensa os limites quando a data devolvida é a que o fut já tem", () => {
      const antiga = "2026-01-10";
      expect(parseMatchDayForm(form({ ...valida, date: antiga }), { hoje: HOJE }).success).toBe(
        false,
      );
      expect(
        parseMatchDayForm(form({ ...valida, date: antiga }), { hoje: HOJE, dataAtual: antiga })
          .success,
      ).toBe(true);
    });

    // A dispensa vale só para a data exata que já está gravada: mover um fut
    // antigo para OUTRA data antiga continua sendo remarcar para o passado.
    it("não dispensa quando a data muda, mesmo partindo de um fut antigo", () => {
      expect(
        parseMatchDayForm(form({ ...valida, date: "2026-01-09" }), {
          hoje: HOJE,
          dataAtual: "2026-01-10",
        }).success,
      ).toBe(false);
    });
  });

  describe("hojeNoFusoDoFut", () => {
    // 03:00 UTC de 13/08 ainda é 12/08 em São Paulo (UTC−3). Sem o fuso
    // explícito, um fut marcado à meia-noite e pouco nasceria "amanhã".
    it("usa o fuso do fut, não o do servidor", () => {
      expect(hojeNoFusoDoFut(new Date("2026-08-13T02:59:00Z"))).toBe("2026-08-12");
      expect(hojeNoFusoDoFut(new Date("2026-08-13T03:01:00Z"))).toBe("2026-08-13");
    });
  });
});
