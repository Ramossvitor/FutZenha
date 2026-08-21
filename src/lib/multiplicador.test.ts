import { describe, expect, it } from "vitest";
import {
  armadoATempo,
  corteEfetivo,
  decidirNoEncerramento,
  TEXTO_DA_DEVOLUCAO,
  type ArmeParaAvaliar,
} from "./multiplicador";

// Um sábado às 20h, e os instantes em volta dele. Datas absolutas e fixas: o
// antiabuso é sobre ordem no tempo, e derivar do relógio da máquina faria o
// teste medir outra coisa em cada execução.
const KICKOFF = new Date("2026-09-05T23:00:00Z"); // 20h em São Paulo
const SEXTA = new Date("2026-09-04T15:00:00Z");
const DEPOIS_DO_JOGO = new Date("2026-09-06T02:00:00Z");

function arme(sobre: Partial<ArmeParaAvaliar> = {}): ArmeParaAvaliar {
  return {
    armadoEm: SEXTA,
    cortePrevisto: KICKOFF,
    kickoffAtual: KICKOFF,
    primeiroSinalDeBola: KICKOFF,
    ...sobre,
  };
}

describe("corteEfetivo", () => {
  it("com tudo igual, é o próprio horário do fut", () => {
    expect(corteEfetivo(arme())).toEqual(KICKOFF);
  });

  // O ataque real: "arma no domingo sabendo que jogou bem". Adiar o fut não
  // pode abrir janela nenhuma — o corte congelado no arme continua valendo.
  it("adiar o fut não move o corte para frente", () => {
    const adiado = new Date("2026-09-12T23:00:00Z");
    expect(corteEfetivo(arme({ kickoffAtual: adiado }))).toEqual(KICKOFF);
  });

  // O lado oposto: antecipar tem que apertar. O arme feito depois do novo
  // horário deixa de valer — e o item volta, em vez de ser aceito às cegas.
  it("antecipar o fut puxa o corte para trás", () => {
    const antecipado = new Date("2026-09-05T18:00:00Z");
    expect(corteEfetivo(arme({ kickoffAtual: antecipado }))).toEqual(antecipado);
  });

  // A testemunha independente: o horário marcado pode não corresponder à
  // realidade, e o primeiro jogo lançado prova que a bola rolou.
  it("o primeiro sinal de bola aperta o corte quando vem antes", () => {
    const cedo = new Date("2026-09-05T21:30:00Z");
    expect(corteEfetivo(arme({ primeiroSinalDeBola: cedo }))).toEqual(cedo);
  });
});

describe("armadoATempo", () => {
  it("armar na véspera vale", () => {
    expect(armadoATempo(arme())).toBe(true);
  });

  it("armar depois da bola rolar não vale", () => {
    expect(armadoATempo(arme({ armadoEm: DEPOIS_DO_JOGO }))).toBe(false);
  });

  // A borda é estrita: armar no instante exato do início já é tarde. Um empate
  // aqui é um relógio de milissegundo decidindo uma aposta.
  it("armar no instante do início não vale", () => {
    expect(armadoATempo(arme({ armadoEm: KICKOFF }))).toBe(false);
    expect(armadoATempo(arme({ armadoEm: new Date(KICKOFF.getTime() - 1) }))).toBe(true);
  });

  it("continua valendo depois de o fut ser adiado", () => {
    const adiado = new Date("2026-09-12T23:00:00Z");
    expect(armadoATempo(arme({ kickoffAtual: adiado }))).toBe(true);
  });

  it("deixa de valer quando o fut é antecipado para antes do arme", () => {
    const antecipado = new Date("2026-09-04T12:00:00Z");
    expect(armadoATempo(arme({ kickoffAtual: antecipado }))).toBe(false);
  });
});

describe("decidirNoEncerramento", () => {
  const jogouComRodada = { jogou: true, houveRodada: true };

  it("arme válido de quem jogou, com rodada aberta, vira fato", () => {
    expect(decidirNoEncerramento(arme(), jogouComRodada)).toBeNull();
  });

  it("quem não entrou em campo tem o item de volta", () => {
    expect(decidirNoEncerramento(arme(), { jogou: false, houveRodada: true })).toBe("nao-jogou");
  });

  it("fut encerrado sem rodada devolve o item", () => {
    expect(decidirNoEncerramento(arme(), { jogou: true, houveRodada: false })).toBe("sem-rodada");
  });

  // O corte vem ANTES das outras checagens de propósito: um arme fora do prazo
  // é inválido mesmo que a pessoa tenha jogado e a rodada exista. Se a ordem
  // fosse outra, o motivo relatado ao jogador seria o secundário.
  it("o corte antecipado tem precedência sobre os outros motivos", () => {
    const antecipado = new Date("2026-09-04T12:00:00Z");
    expect(
      decidirNoEncerramento(arme({ kickoffAtual: antecipado }), { jogou: false, houveRodada: false }),
    ).toBe("corte-antecipado");
  });

  // A devolução vira aviso, e aviso sem texto é uma tela quebrada. O Record é
  // exaustivo pelo tipo, então isto pega o dia em que um motivo novo entrar.
  it("todo motivo de devolução tem texto para o jogador", () => {
    for (const motivo of [
      "nao-jogou",
      "sem-rodada",
      "sem-avaliacao",
      "corte-antecipado",
    ] as const) {
      expect(TEXTO_DA_DEVOLUCAO[motivo].length).toBeGreaterThan(20);
    }
  });
});
