import { describe, expect, it } from "vitest";
import { podeDefinirPresencaPor, podeGerenciarFut, podeJulgarDenuncia } from "./permissions";

const criador = { playerId: 10, isPlatformAdmin: false };
const outro = { playerId: 20, isPlatformAdmin: false };
const plataforma = { playerId: 99, isPlatformAdmin: true };

describe("podeGerenciarFut", () => {
  it("o criador gerencia o próprio fut", () => {
    expect(podeGerenciarFut(criador, { createdByPlayerId: 10 })).toBe(true);
  });

  it("jogador qualquer não gerencia o fut de outro", () => {
    expect(podeGerenciarFut(outro, { createdByPlayerId: 10 })).toBe(false);
  });

  it("admin da plataforma gerencia o fut de qualquer um", () => {
    expect(podeGerenciarFut(plataforma, { createdByPlayerId: 10 })).toBe(true);
  });

  // Fut órfão: anterior ao modelo, ou de criador apagado (FK `set null`).
  it("admin da plataforma gerencia fut órfão", () => {
    expect(podeGerenciarFut(plataforma, { createdByPlayerId: null })).toBe(true);
  });

  // O caso que uma comparação frouxa liberaria para o grupo inteiro.
  it("fut órfão NÃO fica aberto para jogador comum", () => {
    expect(podeGerenciarFut(outro, { createdByPlayerId: null })).toBe(false);
    expect(podeGerenciarFut({ playerId: 0, isPlatformAdmin: false }, { createdByPlayerId: null }))
      .toBe(false);
  });
});

describe("podeGerenciarFut em fut de grupo", () => {
  // Fut criado pelo organizador `criador` (id 10) dentro do grupo 7.
  const futDoGrupo = { createdByPlayerId: 10, groupId: 7 };

  it("o admin do grupo gerencia o fut criado pelo organizador", () => {
    expect(podeGerenciarFut(outro, futDoGrupo, "admin")).toBe(true);
  });

  // O ataque: reescrever placar, gols e escalação de fut alheia mexe no
  // V/E/D e na artilharia de todo mundo que jogou. O poder do organizador é
  // criar — e, ao criar, ele já vira o criador.
  it("organizador NÃO gerencia o fut de outro organizador", () => {
    expect(podeGerenciarFut(outro, futDoGrupo, "organizer")).toBe(false);
  });

  it("membro do grupo não gerencia nada", () => {
    expect(podeGerenciarFut(outro, futDoGrupo, "member")).toBe(false);
    expect(podeGerenciarFut(outro, futDoGrupo, null)).toBe(false);
  });

  it("o criador segue gerenciando, qualquer que seja o papel dele no grupo", () => {
    expect(podeGerenciarFut(criador, futDoGrupo, "member")).toBe(true);
    expect(podeGerenciarFut(criador, futDoGrupo, null)).toBe(true);
  });

  // Documenta que o teste de `groupId` no corpo da função não é redundante: um
  // papel herdado de outra leitura não pode entregar fut avulso ao admin de
  // um grupo qualquer.
  it("fut avulso ignora papel de grupo passado por engano", () => {
    expect(podeGerenciarFut(outro, { createdByPlayerId: 10, groupId: null }, "admin")).toBe(false);
    expect(podeGerenciarFut(outro, { createdByPlayerId: 10 }, "admin")).toBe(false);
  });

  it("admin da plataforma continua passando por cima", () => {
    expect(podeGerenciarFut(plataforma, futDoGrupo, null)).toBe(true);
  });
});

describe("podeDefinirPresencaPor com a lista aberta", () => {
  const ABERTA = false;
  const semConta = { temContaAtiva: false, jaEstaNoFut: false, elegivel: true };
  const comContaDeFora = { temContaAtiva: true, jaEstaNoFut: false, elegivel: true };
  const comContaJaNoFut = { temContaAtiva: true, jaEstaNoFut: true, elegivel: true };

  // O caso que o override existe para resolver: quem não resgatou o convite (ou
  // teve a conta desativada) não consegue se marcar sozinho.
  it("organizador marca por quem não tem conta ativa", () => {
    expect(podeDefinirPresencaPor(criador, semConta, ABERTA)).toBe(true);
  });

  // O ataque: qualquer jogador logado cria fut, então sem isto dava para
  // escalar gente com conta que nunca soube do jogo e mexer na presença e no
  // V/E/D dela (os rankings só contam quem tem conta — ver src/lib/stats.ts).
  it("não escala quem tem conta e ainda não entrou no fut", () => {
    expect(podeDefinirPresencaPor(criador, comContaDeFora, ABERTA)).toBe(false);
  });

  // Ser elegível não é consentimento: um fut de grupo marcado para sábado
  // não autoriza ninguém a montar a lista pelos outros quarenta membros.
  it("ser elegível sozinho não abre a porta enquanto a lista está aberta", () => {
    expect(
      podeDefinirPresencaPor(criador, { ...comContaDeFora, elegivel: true }, ABERTA),
    ).toBe(false);
  });

  it("depois que a pessoa entra, o organizador volta a mandar na presença dela", () => {
    expect(podeDefinirPresencaPor(criador, comContaJaNoFut, ABERTA)).toBe(true);
  });

  // O convidado de última hora não pertence a grupo nenhum ainda — exigir
  // elegibilidade dele mataria justamente o caso que o override existe para
  // resolver.
  it("quem não tem conta segue livre mesmo sem ser elegível", () => {
    expect(podeDefinirPresencaPor(criador, { ...semConta, elegivel: false }, ABERTA)).toBe(true);
  });

  it("admin da plataforma passa por cima nos três casos", () => {
    expect(podeDefinirPresencaPor(plataforma, semConta, ABERTA)).toBe(true);
    expect(podeDefinirPresencaPor(plataforma, comContaDeFora, ABERTA)).toBe(true);
    expect(podeDefinirPresencaPor(plataforma, comContaJaNoFut, ABERTA)).toBe(true);
  });
});

// Fechar a lista é sortear os times: daí em diante o organizador registra quem
// apareceu na quadra, e não monta mais lista.
describe("podeDefinirPresencaPor com a lista fechada", () => {
  const FECHADA = true;

  it("o organizador inclui quem tem conta, não confirmou, mas é elegível", () => {
    expect(
      podeDefinirPresencaPor(
        criador,
        { temContaAtiva: true, jaEstaNoFut: false, elegivel: true },
        FECHADA,
      ),
    ).toBe(true);
  });

  // O limite que sobra: num fut de grupo, o alcance é o grupo — não a
  // plataforma inteira.
  it("não inclui quem tem conta e não é elegível, nem com a lista fechada", () => {
    expect(
      podeDefinirPresencaPor(
        criador,
        { temContaAtiva: true, jaEstaNoFut: false, elegivel: false },
        FECHADA,
      ),
    ).toBe(false);
  });

  // O ex-membro que confirmou e depois saiu do grupo: já está no fut, então
  // o organizador segue mandando na presença dele — a elegibilidade só filtra
  // quem ainda está de fora.
  it("quem já está no fut dispensa elegibilidade", () => {
    expect(
      podeDefinirPresencaPor(
        criador,
        { temContaAtiva: true, jaEstaNoFut: true, elegivel: false },
        FECHADA,
      ),
    ).toBe(true);
  });

  // O bypass vem antes da elegibilidade: o admin da plataforma é o fallback de
  // fut órfão e abandonado, e o alcance dele já é a plataforma inteira.
  it("admin da plataforma inclui até quem não é elegível", () => {
    expect(
      podeDefinirPresencaPor(
        plataforma,
        { temContaAtiva: true, jaEstaNoFut: false, elegivel: false },
        FECHADA,
      ),
    ).toBe(true);
  });

  // Quem não tem conta nunca dependeu de elegibilidade: é o convidado que o
  // organizador cadastra na hora, e ele não está em grupo nenhum ainda.
  it("quem não tem conta segue livre, elegível ou não", () => {
    expect(
      podeDefinirPresencaPor(
        criador,
        { temContaAtiva: false, jaEstaNoFut: false, elegivel: false },
        FECHADA,
      ),
    ).toBe(true);
  });
});

describe("podeJulgarDenuncia", () => {
  const deFora = { julgadorJogouARodada: false };
  const jogou = { julgadorJogouARodada: true };

  it("só a plataforma julga — nem o criador do fut", () => {
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
