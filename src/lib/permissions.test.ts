import { describe, expect, it } from "vitest";
import { podeDefinirPresencaPor, podeGerenciarPelada, podeJulgarDenuncia } from "./permissions";

const criador = { playerId: 10, isPlatformAdmin: false };
const outro = { playerId: 20, isPlatformAdmin: false };
const plataforma = { playerId: 99, isPlatformAdmin: true };

describe("podeGerenciarPelada", () => {
  it("o criador gerencia a própria pelada", () => {
    expect(podeGerenciarPelada(criador, { createdByPlayerId: 10 })).toBe(true);
  });

  it("jogador qualquer não gerencia a pelada de outro", () => {
    expect(podeGerenciarPelada(outro, { createdByPlayerId: 10 })).toBe(false);
  });

  it("admin da plataforma gerencia a pelada de qualquer um", () => {
    expect(podeGerenciarPelada(plataforma, { createdByPlayerId: 10 })).toBe(true);
  });

  // Pelada órfã: anterior ao modelo, ou de criador apagado (FK `set null`).
  it("admin da plataforma gerencia pelada órfã", () => {
    expect(podeGerenciarPelada(plataforma, { createdByPlayerId: null })).toBe(true);
  });

  // O caso que uma comparação frouxa liberaria para o grupo inteiro.
  it("pelada órfã NÃO fica aberta para jogador comum", () => {
    expect(podeGerenciarPelada(outro, { createdByPlayerId: null })).toBe(false);
    expect(podeGerenciarPelada({ playerId: 0, isPlatformAdmin: false }, { createdByPlayerId: null }))
      .toBe(false);
  });
});

describe("podeGerenciarPelada em pelada de grupo", () => {
  // Pelada criada pelo organizador `criador` (id 10) dentro do grupo 7.
  const peladaDoGrupo = { createdByPlayerId: 10, groupId: 7 };

  it("o admin do grupo gerencia a pelada criada pelo organizador", () => {
    expect(podeGerenciarPelada(outro, peladaDoGrupo, "admin")).toBe(true);
  });

  // O ataque: reescrever placar, gols e escalação de pelada alheia mexe no
  // V/E/D e na artilharia de todo mundo que jogou. O poder do organizador é
  // criar — e, ao criar, ele já vira o criador.
  it("organizador NÃO gerencia a pelada de outro organizador", () => {
    expect(podeGerenciarPelada(outro, peladaDoGrupo, "organizer")).toBe(false);
  });

  it("membro do grupo não gerencia nada", () => {
    expect(podeGerenciarPelada(outro, peladaDoGrupo, "member")).toBe(false);
    expect(podeGerenciarPelada(outro, peladaDoGrupo, null)).toBe(false);
  });

  it("o criador segue gerenciando, qualquer que seja o papel dele no grupo", () => {
    expect(podeGerenciarPelada(criador, peladaDoGrupo, "member")).toBe(true);
    expect(podeGerenciarPelada(criador, peladaDoGrupo, null)).toBe(true);
  });

  // Documenta que o teste de `groupId` no corpo da função não é redundante: um
  // papel herdado de outra leitura não pode entregar pelada avulsa ao admin de
  // um grupo qualquer.
  it("pelada avulsa ignora papel de grupo passado por engano", () => {
    expect(podeGerenciarPelada(outro, { createdByPlayerId: 10, groupId: null }, "admin")).toBe(false);
    expect(podeGerenciarPelada(outro, { createdByPlayerId: 10 }, "admin")).toBe(false);
  });

  it("admin da plataforma continua passando por cima", () => {
    expect(podeGerenciarPelada(plataforma, peladaDoGrupo, null)).toBe(true);
  });
});

describe("podeDefinirPresencaPor", () => {
  const semConta = { temContaAtiva: false, jaEstaNaPelada: false };
  const comContaDeFora = { temContaAtiva: true, jaEstaNaPelada: false };
  const comContaJaNaPelada = { temContaAtiva: true, jaEstaNaPelada: true };

  // O caso que o override existe para resolver: quem não resgatou o convite (ou
  // teve a conta desativada) não consegue se marcar sozinho.
  it("organizador marca por quem não tem conta ativa", () => {
    expect(podeDefinirPresencaPor(criador, semConta)).toBe(true);
  });

  // O ataque: qualquer jogador logado cria pelada, então sem isto dava para
  // escalar gente com conta que nunca soube do jogo e mexer na presença e no
  // V/E/D dela (os rankings só contam quem tem conta — ver src/lib/stats.ts).
  it("não escala quem tem conta e ainda não entrou na pelada", () => {
    expect(podeDefinirPresencaPor(criador, comContaDeFora)).toBe(false);
  });

  it("depois que a pessoa entra, o organizador volta a mandar na presença dela", () => {
    expect(podeDefinirPresencaPor(criador, comContaJaNaPelada)).toBe(true);
  });

  it("admin da plataforma passa por cima nos três casos", () => {
    expect(podeDefinirPresencaPor(plataforma, semConta)).toBe(true);
    expect(podeDefinirPresencaPor(plataforma, comContaDeFora)).toBe(true);
    expect(podeDefinirPresencaPor(plataforma, comContaJaNaPelada)).toBe(true);
  });
});

describe("podeJulgarDenuncia", () => {
  const deFora = { julgadorJogouARodada: false };
  const jogou = { julgadorJogouARodada: true };

  it("só a plataforma julga — nem o criador da pelada", () => {
    expect(podeJulgarDenuncia(plataforma, deFora)).toBe(true);
    expect(podeJulgarDenuncia(criador, deFora)).toBe(false);
    expect(podeJulgarDenuncia(outro, deFora)).toBe(false);
  });

  // O buraco que as duas condições juntas fecham: o admin da plataforma também
  // joga, então poderia denunciar a própria nota e, na tela de julgamento, ler o
  // nome de quem lhe deu cada estrela.
  it("nem a plataforma julga rodada que ela mesma jogou", () => {
    expect(podeJulgarDenuncia(plataforma, jogou)).toBe(false);
  });

  it("ter jogado não promove ninguém: jogador comum segue de fora nos dois casos", () => {
    expect(podeJulgarDenuncia(outro, jogou)).toBe(false);
    expect(podeJulgarDenuncia(outro, deFora)).toBe(false);
  });
});
