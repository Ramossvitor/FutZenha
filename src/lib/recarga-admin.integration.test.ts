// O painel da recarga contra o banco de verdade.
//
// O que este arquivo vigia é o caixa: cada número do resumo tem que contar pela
// SUA data. O Pix criado num mês e pago no outro é o caso que separa um caixa
// que fecha de um que engole dinheiro — e ele acontece todo fim de mês, não é
// hipótese de laboratório.

import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { listarTodosPacotes, resumoDoMes, validarPacote } from "@/lib/recarga-admin";
import { criarJogadorComConta } from "@/test/fixtures";
import { criarPacote, criarPedidoDireto } from "@/test/fixtures-recarga";

/** Quarenta dias atrás cai no mês anterior em qualquer dia do mês corrente. */
const MES_PASSADO_MINUTOS = 40 * 24 * 60;
const MES_PASSADO_DIAS = 40;

describe("resumoDoMes", () => {
  it("conta o arrecadado pelo mês do PAGAMENTO, não pelo da criação", async () => {
    const { jogador } = await criarJogadorComConta();
    const pacote = await criarPacote({ precoCentavos: 1000, zenhas: 250 });

    // O caso que importa: comprado no mês passado, pago neste. O dinheiro entrou
    // agora e é agora que ele conta.
    await criarPedidoDireto(jogador.id, pacote, {
      status: "pago",
      criadoHaMinutos: MES_PASSADO_MINUTOS,
      pagoHaDias: 0,
    });
    // E o espelho dele: comprado e pago no mês passado — não conta aqui.
    await criarPedidoDireto(jogador.id, pacote, {
      status: "pago",
      criadoHaMinutos: MES_PASSADO_MINUTOS,
      pagoHaDias: MES_PASSADO_DIAS,
    });

    const resumo = await resumoDoMes(db);

    expect(resumo.arrecadadoCentavos).toBe(1000);
    expect(resumo.pagos).toBe(1);
  });

  it("soma os pagos do mês e ignora o que não é pago", async () => {
    const { jogador } = await criarJogadorComConta();
    const pacote = await criarPacote({ precoCentavos: 2000, zenhas: 550 });

    await criarPedidoDireto(jogador.id, pacote, { status: "pago" });
    await criarPedidoDireto(jogador.id, pacote, { status: "pago" });
    await criarPedidoDireto(jogador.id, pacote, { status: "pendente" });
    await criarPedidoDireto(jogador.id, pacote, { status: "cancelado" });
    await criarPedidoDireto(jogador.id, pacote, {
      status: "expirado",
      criadoHaMinutos: 60,
      expiraEmMinutos: 30,
    });

    const resumo = await resumoDoMes(db);

    expect(resumo.arrecadadoCentavos).toBe(4000);
    expect(resumo.pagos).toBe(2);
    expect(resumo.pendentes).toBe(1);
    expect(resumo.estornados).toBe(0);
  });

  it("conta o estorno pelo mês em que o dinheiro voltou", async () => {
    const { jogador } = await criarJogadorComConta();
    const pacote = await criarPacote();

    await criarPedidoDireto(jogador.id, pacote, { status: "estornado", pagoHaDias: 0 });
    await criarPedidoDireto(jogador.id, pacote, {
      status: "estornado",
      criadoHaMinutos: MES_PASSADO_MINUTOS,
      pagoHaDias: MES_PASSADO_DIAS,
    });

    expect((await resumoDoMes(db)).estornados).toBe(1);
  });

  it("banco vazio devolve zeros em vez de nulo", async () => {
    expect(await resumoDoMes(db)).toEqual({
      arrecadadoCentavos: 0,
      pagos: 0,
      pendentes: 0,
      estornados: 0,
    });
  });
});

describe("listarTodosPacotes", () => {
  it("mostra os retirados junto dos ativos, ativos primeiro", async () => {
    const ativo = await criarPacote({ ativo: true, ordem: 2 });
    const retirado = await criarPacote({ ativo: false, ordem: 1 });

    const pacotes = await listarTodosPacotes(db);

    expect(pacotes.map((p) => p.id)).toEqual([ativo.id, retirado.id]);
  });
});

describe("validarPacote", () => {
  const bom = { nome: "Punhado", precoCentavos: 1000, zenhas: 250, ordem: 1 };

  it("aceita o pacote plausível", () => {
    expect(validarPacote(bom)).toBeNull();
  });

  // O teto é freio contra dedo escorregado, não regra de produto: um zero a mais
  // no formulário viraria uma cobrança Pix de R$ 4.000 na tela de alguém.
  it("recusa o que o check do banco também recusaria", () => {
    expect(validarPacote({ ...bom, nome: "   " })).toBe("dados-invalidos");
    expect(validarPacote({ ...bom, precoCentavos: 0 })).toBe("dados-invalidos");
    expect(validarPacote({ ...bom, precoCentavos: 100001 })).toBe("dados-invalidos");
    expect(validarPacote({ ...bom, precoCentavos: 10.5 })).toBe("dados-invalidos");
    expect(validarPacote({ ...bom, zenhas: 0 })).toBe("dados-invalidos");
    expect(validarPacote({ ...bom, ordem: -1 })).toBe("dados-invalidos");
  });
});
