import { describe, expect, it } from "vitest";
import {
  motivoDeBloqueioDeAgenda,
  TETO_AGENDA_DIA,
  TETO_AGENDA_POR_JOGADOR_DIA,
  TETO_DIARIO,
  type ContagensDeAgenda,
} from "./freios-de-envio";

const livre: ContagensDeAgenda = {
  recebeuHaPouco: false,
  doJogadorNoDia: 0,
  daInstalacaoNoDia: 0,
};

describe("motivoDeBloqueioDeAgenda", () => {
  it("libera quando nada estourou", () => {
    expect(motivoDeBloqueioDeAgenda(livre)).toBeNull();
  });

  it("barra quem acabou de receber neste fut", () => {
    expect(motivoDeBloqueioDeAgenda({ ...livre, recebeuHaPouco: true })).toBe("envio-recente");
  });

  // As bordas, uma a uma: é onde um `>` no lugar de `>=` passaria despercebido.
  it("o teto por jogador barra EM cima, não depois", () => {
    expect(
      motivoDeBloqueioDeAgenda({ ...livre, doJogadorNoDia: TETO_AGENDA_POR_JOGADOR_DIA - 1 }),
    ).toBeNull();
    expect(
      motivoDeBloqueioDeAgenda({ ...livre, doJogadorNoDia: TETO_AGENDA_POR_JOGADOR_DIA }),
    ).toBe("teto-do-jogador");
  });

  it("o teto da instalação barra EM cima, não depois", () => {
    expect(
      motivoDeBloqueioDeAgenda({ ...livre, daInstalacaoNoDia: TETO_AGENDA_DIA - 1 }),
    ).toBeNull();
    expect(motivoDeBloqueioDeAgenda({ ...livre, daInstalacaoNoDia: TETO_AGENDA_DIA })).toBe(
      "teto-da-agenda",
    );
  });

  // A ordem é parte da regra: quem alterna presença num dia movimentado tem que
  // ver o motivo DELE, não o da instalação.
  it("o motivo mais específico vence", () => {
    const tudoEstourado: ContagensDeAgenda = {
      recebeuHaPouco: true,
      doJogadorNoDia: TETO_AGENDA_POR_JOGADOR_DIA,
      daInstalacaoNoDia: TETO_AGENDA_DIA,
    };
    expect(motivoDeBloqueioDeAgenda(tudoEstourado)).toBe("envio-recente");
    expect(motivoDeBloqueioDeAgenda({ ...tudoEstourado, recebeuHaPouco: false })).toBe(
      "teto-do-jogador",
    );
  });
});

// A asserção que dá sentido ao sub-teto: se ele deixar de ser menor que o teto
// geral, a agenda volta a poder consumir a cota inteira e o link de redefinição
// de acesso fica sem margem. É o invariante do módulo, não um detalhe.
describe("o sub-teto protege o canal de recuperação de conta", () => {
  it("a agenda nunca pode gastar a cota inteira da instalação", () => {
    expect(TETO_AGENDA_DIA).toBeLessThan(TETO_DIARIO);
  });

  it("sobra margem de verdade para convite e redefinição de acesso", () => {
    expect(TETO_DIARIO - TETO_AGENDA_DIA).toBeGreaterThanOrEqual(50);
  });
});
