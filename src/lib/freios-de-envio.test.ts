import { describe, expect, it } from "vitest";
import {
  motivoDeBloqueioDeAgenda,
  TETO_AGENDA_DIA,
  TETO_AGENDA_POR_JOGADOR_DIA,
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

