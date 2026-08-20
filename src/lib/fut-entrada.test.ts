import { describe, expect, it } from "vitest";
import {
  comoEntraNoFut,
  futAceitaEntrada,
  podeConvidarParaFut,
  type FutParaEntrada,
} from "./fut-entrada";

const alguem = { playerId: 10, isPlatformAdmin: false };
const plataforma = { playerId: 99, isPlatformAdmin: true };

const AVULSO: FutParaEntrada = { status: "scheduled", groupId: null };
const DE_GRUPO: FutParaEntrada = { status: "scheduled", groupId: 7 };

describe("futAceitaEntrada", () => {
  it("só antes do sorteio", () => {
    expect(futAceitaEntrada(AVULSO)).toBe(true);
    expect(futAceitaEntrada({ ...AVULSO, status: "teams_drawn" })).toBe(false);
    expect(futAceitaEntrada({ ...AVULSO, status: "finished" })).toBe(false);
  });
});

describe("podeConvidarParaFut", () => {
  const semVinculo = { ehOrganizador: false, jaJogouComOAlvo: false, alvoRecusou: false };
  const comVinculo = { ehOrganizador: false, jaJogouComOAlvo: true, alvoRecusou: false };

  it("em fut de grupo, quem organiza chama — o alcance ali já é o grupo", () => {
    const organizador = { ehOrganizador: true, jaJogouComOAlvo: false, alvoRecusou: false };
    expect(podeConvidarParaFut(alguem, DE_GRUPO, organizador)).toBe(true);
  });

  // O buraco que organizar-por-si-só abria. Criar fut é auto-servível: se
  // `ehOrganizador` bastasse, qualquer conta marcaria um fut avulso e passaria a
  // alcançar TODO jogador com conta — um convite, com notificação e push, por
  // pessoa. É o mesmo megafone que podeDefinirPresencaPor acabou de fechar.
  it("em fut avulso, organizar não basta: sem vínculo, não chama", () => {
    const organizador = { ehOrganizador: true, jaJogouComOAlvo: false, alvoRecusou: false };
    expect(podeConvidarParaFut(alguem, AVULSO, organizador)).toBe(false);
  });

  // O vínculo que substitui "a plataforma inteira" no fut avulso. Vale para
  // quem organiza e para quem não organiza — o que conta é ter jogado junto.
  it("em fut avulso, quem já jogou com a pessoa chama", () => {
    expect(podeConvidarParaFut(alguem, AVULSO, comVinculo)).toBe(true);
    expect(
      podeConvidarParaFut(alguem, AVULSO, {
        ehOrganizador: true,
        jaJogouComOAlvo: true,
        alvoRecusou: false,
      }),
    ).toBe(true);
  });

  // A regressão que este módulo existe para travar: sem o vínculo, qualquer
  // pessoa logada alcançava qualquer outra.
  it("em fut avulso, estranho não chama estranho", () => {
    expect(podeConvidarParaFut(alguem, AVULSO, semVinculo)).toBe(false);
  });

  // Em fut de grupo o convite é do grupo, não do histórico: já ter jogado junto
  // não dá a ninguém o direito de puxar gente para dentro de um fut de grupo.
  it("em fut de grupo, ter jogado junto não basta", () => {
    expect(podeConvidarParaFut(alguem, DE_GRUPO, comVinculo)).toBe(false);
  });

  it("fut sorteado ou encerrado não aceita convite de ninguém", () => {
    const organizador = { ehOrganizador: true, jaJogouComOAlvo: true, alvoRecusou: false };
    expect(podeConvidarParaFut(alguem, { ...AVULSO, status: "teams_drawn" }, organizador)).toBe(
      false,
    );
    expect(podeConvidarParaFut(plataforma, { ...AVULSO, status: "finished" }, organizador)).toBe(
      false,
    );
  });

  it("admin da plataforma chama em fut aberto", () => {
    expect(podeConvidarParaFut(plataforma, AVULSO, semVinculo)).toBe(true);
    expect(podeConvidarParaFut(plataforma, DE_GRUPO, semVinculo)).toBe(true);
  });

  // A porta dos fundos do bloqueio de presença. Barrado no botão "Vai", quem
  // organiza mandaria convite atrás de convite — e o índice único de
  // match_day_invitations é parcial em `pending`, então uma recusa não estorva a
  // próxima linha. Nada além desta regra limita quantos convites saem.
  it("quem recusou não é chamado de novo — nem por quem tem vínculo", () => {
    expect(podeConvidarParaFut(alguem, AVULSO, { ...comVinculo, alvoRecusou: true })).toBe(false);
    expect(
      podeConvidarParaFut(alguem, DE_GRUPO, {
        ehOrganizador: true,
        jaJogouComOAlvo: true,
        alvoRecusou: true,
      }),
    ).toBe(false);
  });

  it("nem pelo admin da plataforma", () => {
    expect(podeConvidarParaFut(plataforma, AVULSO, { ...semVinculo, alvoRecusou: true })).toBe(
      false,
    );
    expect(podeConvidarParaFut(plataforma, DE_GRUPO, { ...semVinculo, alvoRecusou: true })).toBe(
      false,
    );
  });
});

describe("comoEntraNoFut", () => {
  const deFora = { jaEstaNaLista: false, elegivel: true, noCirculo: false };
  const doCirculo = { ...deFora, noCirculo: true };

  it("quem já está na lista não entra de novo", () => {
    expect(comoEntraNoFut(AVULSO, { ...deFora, jaEstaNaLista: true })).toBe("ja-esta");
  });

  // Fut de grupo não muda: ser membro sempre bastou, e entrar no grupo foi o
  // consentimento.
  it("membro entra direto em fut de grupo", () => {
    expect(comoEntraNoFut(DE_GRUPO, deFora)).toBe("entra-direto");
  });

  it("quem não é do grupo não entra em fut de grupo", () => {
    expect(comoEntraNoFut(DE_GRUPO, { ...deFora, elegivel: false })).toBe("fechada");
  });

  // O ponto do desenho: em fut avulso quem chegou pela aba de explorar PEDE, e
  // quem decide continua sendo quem organiza.
  it("em fut avulso, quem vem de fora pede", () => {
    expect(comoEntraNoFut(AVULSO, deFora)).toBe("pede-entrada");
  });

  // ...e quem é do círculo entra sozinho. É o mesmo conjunto que recebe o aviso
  // de "fut marcado": quem é avisado consegue entrar, quem não é, pede.
  it("em fut avulso, quem é do círculo entra direto", () => {
    expect(comoEntraNoFut(AVULSO, doCirculo)).toBe("entra-direto");
  });

  // Quem ORGANIZA é do círculo por definição — mas quem sabe disso é o
  // `estaNoCirculoDoFut` (src/lib/fut-entrada-db.ts), não este módulo, que só
  // recebe o booleano. O caso está coberto lá, com banco.

  // O estado do fut vem antes do vínculo — a mesma ordem de podeEntrarNoGrupo,
  // e pelo mesmo motivo: olhar a elegibilidade primeiro deixaria membro de
  // grupo entrar num fut que já sorteou os times.
  it("fut sorteado está fechado, inclusive para membro e para o círculo", () => {
    expect(comoEntraNoFut({ ...DE_GRUPO, status: "teams_drawn" }, deFora)).toBe("fechada");
    expect(comoEntraNoFut({ ...AVULSO, status: "teams_drawn" }, doCirculo)).toBe("fechada");
  });

  // ...mas quem JÁ está na lista continua na lista depois do sorteio: o estado
  // do fut não pode apagar um fato.
  it("o sorteio não expulsa quem já estava", () => {
    expect(
      comoEntraNoFut({ ...AVULSO, status: "teams_drawn" }, { ...deFora, jaEstaNaLista: true }),
    ).toBe("ja-esta");
  });
});
