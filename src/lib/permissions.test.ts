import { describe, expect, it } from "vitest";
import {
  podeDefinirPresencaPor,
  podeGerenciarFut,
  podeJulgarDenuncia,
  podeOperarSumula,
} from "./permissions";

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
  const ABERTA = { listaFechada: false, ehDeGrupo: true };
  const semConta = { temContaAtiva: false, jaEstaNoFut: false, elegivel: true, recusou: false };
  const comContaDeFora = { temContaAtiva: true, jaEstaNoFut: false, elegivel: true, recusou: false };
  const comContaJaNoFut = { temContaAtiva: true, jaEstaNoFut: true, elegivel: true, recusou: false };

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
describe("podeDefinirPresencaPor com a lista fechada, em fut de GRUPO", () => {
  const FECHADA = { listaFechada: true, ehDeGrupo: true };

  it("o organizador inclui quem tem conta, não confirmou, mas é elegível", () => {
    expect(
      podeDefinirPresencaPor(
        criador,
        { temContaAtiva: true, jaEstaNoFut: false, elegivel: true, recusou: false },
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
        { temContaAtiva: true, jaEstaNoFut: false, elegivel: false, recusou: false },
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
        { temContaAtiva: true, jaEstaNoFut: true, elegivel: false, recusou: false },
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
        { temContaAtiva: true, jaEstaNoFut: false, elegivel: false, recusou: false },
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
        { temContaAtiva: false, jaEstaNoFut: false, elegivel: false, recusou: false },
        FECHADA,
      ),
    ).toBe(true);
  });
});

// O buraco que `ehDeGrupo` fechou. Em fut avulso, `condicaoElegivel` não filtra
// nada (devolve `undefined`, que o `and()` do drizzle descarta), então
// `elegivel: true` ali quer dizer "qualquer jogador ativo da plataforma". Com a
// lista fechada, isso deixava quem criasse um fut avulso marcar presença de
// estranhos — e cada marcação dispara notificação, push e um e-mail de
// calendário com texto livre para a caixa da vítima.
describe("podeDefinirPresencaPor com a lista fechada, em fut AVULSO", () => {
  const FECHADA_AVULSA = { listaFechada: true, ehDeGrupo: false };

  it("NÃO inclui estranho com conta ativa, mesmo 'elegível'", () => {
    expect(
      podeDefinirPresencaPor(
        criador,
        { temContaAtiva: true, jaEstaNoFut: false, elegivel: true, recusou: false },
        FECHADA_AVULSA,
      ),
    ).toBe(false);
  });

  // O caso legítimo continua de pé: o convidado que chegou na hora não tem
  // conta, não tem como se marcar, e é para ele que a exceção existe.
  it("quem não tem conta continua livre", () => {
    expect(
      podeDefinirPresencaPor(
        criador,
        { temContaAtiva: false, jaEstaNoFut: false, elegivel: false, recusou: false },
        FECHADA_AVULSA,
      ),
    ).toBe(true);
  });

  it("quem já está no fut continua sob o organizador", () => {
    expect(
      podeDefinirPresencaPor(
        criador,
        { temContaAtiva: true, jaEstaNoFut: true, elegivel: false, recusou: false },
        FECHADA_AVULSA,
      ),
    ).toBe(true);
  });

  it("admin da plataforma segue sendo o fallback de fut órfão", () => {
    expect(
      podeDefinirPresencaPor(
        plataforma,
        { temContaAtiva: true, jaEstaNoFut: false, elegivel: true, recusou: false },
        FECHADA_AVULSA,
      ),
    ).toBe(true);
  });
});

// A recusa é a palavra final da lista. Cobre as duas formas de dizer não —
// recusar o convite do fut e tirar o próprio nome —, que `situacaoDoAlvo`
// (src/lib/presenca.ts) já entrega colapsadas num booleano.
describe("podeDefinirPresencaPor depois que a pessoa recusou", () => {
  const recusou = { temContaAtiva: true, jaEstaNoFut: true, elegivel: true, recusou: true };

  // Este é o caso que a coluna existe para fechar: `jaEstaNoFut` é "tem linha em
  // attendances", e linha `out` é linha — então SAIR da lista era justamente o
  // que mais liberava o organizador a repor, quantas vezes ele quisesse.
  it("o organizador não repõe quem saiu, mesmo com a lista fechada", () => {
    expect(podeDefinirPresencaPor(criador, recusou, { listaFechada: true, ehDeGrupo: true })).toBe(
      false,
    );
  });

  it("nem com a lista aberta, nem em fut avulso", () => {
    expect(podeDefinirPresencaPor(criador, recusou, { listaFechada: false, ehDeGrupo: true })).toBe(
      false,
    );
    expect(podeDefinirPresencaPor(criador, recusou, { listaFechada: true, ehDeGrupo: false })).toBe(
      false,
    );
  });

  // A única regra deste módulo que o admin da plataforma NÃO atravessa. O
  // fallback dele conserta fut órfão e fut abandonado — desfazer o "não" de uma
  // pessoa não é conserto, e é o que ninguém mais deveria poder fazer.
  it("o admin da plataforma também é barrado — é a única regra que ele não atravessa", () => {
    expect(
      podeDefinirPresencaPor(plataforma, recusou, { listaFechada: true, ehDeGrupo: true }),
    ).toBe(false);
  });

  // A recusa vem ANTES de tudo, inclusive do ramo "quem não tem conta é livre".
  // Na prática quem não tem conta não recusa (não tem por onde), mas a ordem das
  // cláusulas é o que garante que nenhum ramo futuro passe por baixo dela.
  it("vem antes até do ramo de quem não tem conta", () => {
    expect(
      podeDefinirPresencaPor(
        criador,
        { ...recusou, temContaAtiva: false },
        { listaFechada: true, ehDeGrupo: true },
      ),
    ).toBe(false);
  });
});

describe("podeOperarSumula", () => {
  const fut = { createdByPlayerId: 10 };

  it("quem gerencia o fut opera a súmula sem precisar de delegação", () => {
    expect(podeOperarSumula(criador, fut)).toBe(true);
    expect(podeOperarSumula(plataforma, fut)).toBe(true);
    expect(podeOperarSumula(outro, { createdByPlayerId: 10, groupId: 7 }, "admin")).toBe(true);
  });

  it("jogador comum só entra com delegação", () => {
    expect(podeOperarSumula(outro, fut)).toBe(false);
    expect(podeOperarSumula(outro, fut, null, true)).toBe(true);
  });

  // A delegação é da súmula, não do fut: quem confere se o delegado pode
  // encerrar, sortear ou editar placar no /gerenciar é `podeGerenciarFut`,
  // e ela não sabe que a delegação existe. Este teste documenta a fronteira.
  it("delegação NÃO promove ninguém a admin do fut", () => {
    expect(podeGerenciarFut(outro, fut)).toBe(false);
  });

  it("em fut de grupo, membro e organizador continuam de fora sem delegação", () => {
    const futDoGrupo = { createdByPlayerId: 10, groupId: 7 };
    expect(podeOperarSumula(outro, futDoGrupo, "member")).toBe(false);
    expect(podeOperarSumula(outro, futDoGrupo, "organizer")).toBe(false);
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
