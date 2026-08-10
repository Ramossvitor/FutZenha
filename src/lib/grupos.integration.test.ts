// O read model da tela de gerenciar grupo. `convitesEnviados` decide o que o
// organizador vê e o que ele pode fazer: o selo de e-mail e a existência do
// botão "Reenviar e-mail" saem daqui, e o join de conta ativa tem que espelhar
// a elegibilidade que enviarAvisoDeGrupo aplica — senão a tela oferece um botão
// que só devolveria convite-inelegivel.

import { describe, expect, it } from "vitest";
import { convitesEnviados } from "@/lib/grupos";
import { criarConta, criarJogador } from "@/test/fixtures";
import { criarConviteDeGrupo, criarGrupo } from "@/test/fixtures-grupo";

const EMAIL = "convidado@example.com";

describe("convitesEnviados", () => {
  it("convite pendente de conta ativa com e-mail tem destino", async () => {
    const groupId = await criarGrupo();
    const jogador = await criarJogador({ name: "Fulano", nickname: "Fu" });
    await criarConta(jogador, { email: EMAIL });
    const convite = await criarConviteDeGrupo(groupId, jogador);

    const [linha] = await convitesEnviados(groupId);

    expect(linha).toMatchObject({
      id: convite.id,
      playerId: jogador.id,
      name: "Fulano",
      nickname: "Fu",
      temEmail: true,
    });
  });

  it("conta desativada não tem destino — o botão de reenviar não aparece", async () => {
    const groupId = await criarGrupo();
    const jogador = await criarJogador();
    await criarConta(jogador, { email: EMAIL, active: false });
    await criarConviteDeGrupo(groupId, jogador);

    const [linha] = await convitesEnviados(groupId);

    expect(linha.temEmail).toBe(false);
  });

  it("jogador sem conta não tem destino", async () => {
    const groupId = await criarGrupo();
    const semConta = await criarJogador();
    await criarConviteDeGrupo(groupId, semConta);

    const [linha] = await convitesEnviados(groupId);

    expect(linha.temEmail).toBe(false);
  });

  it("sem envio nenhum, emailSentAt é nulo", async () => {
    const groupId = await criarGrupo();
    const jogador = await criarJogador();
    await criarConta(jogador, { email: EMAIL });
    await criarConviteDeGrupo(groupId, jogador);

    const [linha] = await convitesEnviados(groupId);

    expect(linha.emailSentAt).toBeNull();
  });

  // O selo é do PAR (grupo, jogador), não desta linha: o dedupe de 24h do aviso
  // automático olha o histórico do par, então revogar e reconvidar não pode
  // fazer a tela dizer "e-mail não saiu" para quem recebeu e-mail há uma hora.
  it("o envio de um convite anterior do mesmo par aparece na linha atual", async () => {
    const groupId = await criarGrupo();
    const jogador = await criarJogador();
    await criarConta(jogador, { email: EMAIL });
    await criarConviteDeGrupo(groupId, jogador, {
      status: "revoked",
      emailEnviadoHaMinutos: 60,
    });
    await criarConviteDeGrupo(groupId, jogador);

    const [linha] = await convitesEnviados(groupId);

    expect(linha.emailSentAt).not.toBeNull();
  });

  // O par é (grupo, jogador): o e-mail que a pessoa recebeu por OUTRO grupo não
  // é sobre este, e o selo daqui não pode herdá-lo.
  it("o envio por outro grupo não aparece na linha deste", async () => {
    const jogador = await criarJogador();
    await criarConta(jogador, { email: EMAIL });
    const outroGrupo = await criarGrupo("Grupo Alheio");
    await criarConviteDeGrupo(outroGrupo, jogador, { emailEnviadoHaMinutos: 60 });
    const groupId = await criarGrupo();
    await criarConviteDeGrupo(groupId, jogador);

    const [linha] = await convitesEnviados(groupId);

    expect(linha.emailSentAt).toBeNull();
  });

  it("convite respondido sai da lista", async () => {
    const groupId = await criarGrupo();
    const jogador = await criarJogador();
    await criarConta(jogador, { email: EMAIL });
    await criarConviteDeGrupo(groupId, jogador, { status: "declined" });

    expect(await convitesEnviados(groupId)).toEqual([]);
  });
});
