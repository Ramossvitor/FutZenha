import { describe, expect, it } from "vitest";
import { lerColeteDoForm, lerColetesDoForm } from "./coletes-form";
import { NOME_DE_TIME_MAX } from "./regras";
import { ESCOLHA_OUTRA_COR, ESCOLHA_SEM_COLETE } from "./team-colors";

function form(campos: Record<string, string>): FormData {
  const f = new FormData();
  for (const [campo, valor] of Object.entries(campos)) f.set(campo, valor);
  return f;
}

// O que o browser manda de verdade: o seletor livre vai SEMPRE, escolhido ou não.
const CINZA_DO_SELETOR = "#888888";

describe("lerColeteDoForm", () => {
  it("amostra: a cor é o valor do rádio, e o seletor livre é ignorado", () => {
    expect(
      lerColeteDoForm(form({ nome: "Com Colete", cor: "#f2740f", corLivre: CINZA_DO_SELETOR })),
    ).toEqual({ success: true, data: { nome: "Com Colete", cor: "#f2740f" } });
  });

  it("outra: lê o seletor livre — e o normaliza para minúsculas", () => {
    expect(
      lerColeteDoForm(form({ nome: "Azulão", cor: ESCOLHA_OUTRA_COR, corLivre: "#1E90FF" })),
    ).toEqual({ success: true, data: { nome: "Azulão", cor: "#1e90ff" } });
  });

  it("sem colete: cor nula, ignorando o seletor livre", () => {
    expect(
      lerColeteDoForm(form({ nome: "Sem Colete", cor: ESCOLHA_SEM_COLETE, corLivre: "#1e90ff" })),
    ).toEqual({ success: true, data: { nome: "Sem Colete", cor: null } });
  });

  it("apara o nome; recusa vazio, quebra de linha e nome comprido", () => {
    expect(lerColeteDoForm(form({ nome: "  Preto  ", cor: "#15181a" }))).toMatchObject({
      success: true,
      data: { nome: "Preto" },
    });
    for (const nome of ["", "   ", "Com\nColete", "x".repeat(NOME_DE_TIME_MAX + 1)]) {
      expect(lerColeteDoForm(form({ nome, cor: "#15181a" }))).toEqual({
        success: false,
        erro: "nome-de-time-invalido",
      });
    }
    expect(lerColeteDoForm(form({ nome: "x".repeat(NOME_DE_TIME_MAX), cor: "#15181a" })).success).toBe(
      true,
    );
  });

  it("recusa cor fora do formato — rádio forjado, seletor estranho ou rádio ausente", () => {
    const casos: Record<string, string>[] = [
      { nome: "Preto", cor: "vermelho" },
      { nome: "Preto", cor: ESCOLHA_OUTRA_COR, corLivre: "red" },
      { nome: "Preto", cor: ESCOLHA_OUTRA_COR },
      { nome: "Preto" },
    ];
    for (const campos of casos) {
      expect(lerColeteDoForm(form(campos))).toEqual({
        success: false,
        erro: "nome-de-time-invalido",
      });
    }
  });

  it("lê com sufixo, para os blocos do grupo", () => {
    const f = form({ "nome-2": "Verde", "cor-2": "#16a868", nome: "Outro", cor: "#000000" });
    expect(lerColeteDoForm(f, "-2")).toEqual({
      success: true,
      data: { nome: "Verde", cor: "#16a868" },
    });
  });
});

describe("lerColetesDoForm", () => {
  const bloco = (i: number, nome: string, cor: string) => ({
    [`nome-${i}`]: nome,
    [`cor-${i}`]: cor,
    [`corLivre-${i}`]: CINZA_DO_SELETOR,
  });

  it("tudo em branco = usar os padrões", () => {
    expect(lerColetesDoForm(form({ "nome-0": "", "nome-1": "  ", "cor-0": "#15181a" }))).toEqual({
      success: true,
      data: [],
    });
  });

  it("lê as linhas usadas, na ordem", () => {
    const f = form({
      ...bloco(0, "Com Colete", "#f2740f"),
      ...bloco(1, "Sem Colete", ESCOLHA_SEM_COLETE),
      ...bloco(2, "Reserva", ESCOLHA_OUTRA_COR),
      "corLivre-2": "#ABCDEF",
      "nome-3": "",
    });
    expect(lerColetesDoForm(f)).toEqual({
      success: true,
      data: [
        { nome: "Com Colete", cor: "#f2740f" },
        { nome: "Sem Colete", cor: null },
        { nome: "Reserva", cor: "#abcdef" },
      ],
    });
  });

  it("um colete só não é lista", () => {
    expect(lerColetesDoForm(form(bloco(0, "Preto", "#15181a")))).toEqual({
      success: false,
      erro: "coletes-incompletos",
    });
  });

  it("pular linha é recusado", () => {
    const f = form({ ...bloco(0, "Preto", "#15181a"), ...bloco(2, "Verde", "#16a868") });
    expect(lerColetesDoForm(f)).toEqual({ success: false, erro: "coletes-incompletos" });
  });

  it("nome repetido, sem olhar caixa e espaço", () => {
    const f = form({ ...bloco(0, "Preto", "#15181a"), ...bloco(1, " preto ", "#e8edea") });
    expect(lerColetesDoForm(f)).toEqual({ success: false, erro: "nome-de-time-repetido" });
  });

  it("linha inválida devolve o erro dela", () => {
    const f = form({ ...bloco(0, "Preto", "#15181a"), ...bloco(1, "Roxo", "roxo") });
    expect(lerColetesDoForm(f)).toEqual({ success: false, erro: "nome-de-time-invalido" });
  });

  it("aceita os seis, e ignora um sétimo bloco forjado", () => {
    const campos = Object.assign(
      {},
      ...Array.from({ length: 7 }, (_, i) => bloco(i, `Time ${i + 1}`, "#15181a")),
    );
    const lido = lerColetesDoForm(form(campos));
    expect(lido.success).toBe(true);
    if (lido.success) expect(lido.data.map((c) => c.nome)).toHaveLength(6);
  });
});
