import { describe, expect, it } from "vitest";
import {
  jogoEmAndamento,
  marcarPodeDesfazer,
  montarLinhaDoTempo,
  podeDesfazerLancamento,
  sumulaDisponivel,
  tempoAtras,
} from "./sumula";

const AGORA = new Date("2026-08-17T19:32:00Z");

describe("jogoEmAndamento", () => {
  it("começou e não terminou: em andamento", () => {
    expect(jogoEmAndamento({ startedAt: AGORA, finishedAt: null })).toBe(true);
  });

  it("começou e terminou: encerrado", () => {
    expect(jogoEmAndamento({ startedAt: AGORA, finishedAt: AGORA })).toBe(false);
  });

  // O jogo do fluxo clássico do /gerenciar — placar digitado pronto — tem os
  // dois timestamps nulos e nunca pode ser "em andamento", senão todo fut
  // antigo apareceria com jogo aberto.
  it("jogo clássico (dois nulos) nunca está em andamento", () => {
    expect(jogoEmAndamento({ startedAt: null, finishedAt: null })).toBe(false);
  });

  // Estado que as actions nunca gravam (finalizar exige started_at no WHERE),
  // mas se uma linha corrompida aparecer, ela deve contar como encerrada.
  it("terminou sem começar: não está em andamento", () => {
    expect(jogoEmAndamento({ startedAt: null, finishedAt: AGORA })).toBe(false);
  });
});

describe("podeDesfazerLancamento", () => {
  it("delegado desfaz o último ativo do lado, com o jogo em andamento", () => {
    expect(
      podeDesfazerLancamento({ ehAdminDoFut: false, jogoEmAndamento: true, ultimoDoLado: true }),
    ).toBe(true);
  });

  // A trava do abuso: reescrever o passado do jogo é poder do admin, não de
  // quem recebeu a súmula emprestada.
  it("delegado NÃO desfaz lançamento que já não é o último do lado", () => {
    expect(
      podeDesfazerLancamento({ ehAdminDoFut: false, jogoEmAndamento: true, ultimoDoLado: false }),
    ).toBe(false);
  });

  it("admin do fut desfaz qualquer lançamento do jogo em andamento", () => {
    expect(
      podeDesfazerLancamento({ ehAdminDoFut: true, jogoEmAndamento: true, ultimoDoLado: false }),
    ).toBe(true);
  });

  // Finalizar encerra a exposição do painel para os dois papéis: depois disso,
  // correção é assunto do /gerenciar (com as travas de lá, inclusive a janela
  // de 24h pós-encerramento do fut).
  it("jogo fora de andamento tranca o desfazer até para o admin", () => {
    expect(
      podeDesfazerLancamento({ ehAdminDoFut: true, jogoEmAndamento: false, ultimoDoLado: true }),
    ).toBe(false);
    expect(
      podeDesfazerLancamento({ ehAdminDoFut: false, jogoEmAndamento: false, ultimoDoLado: true }),
    ).toBe(false);
  });
});

describe("sumulaDisponivel", () => {
  it("só com os times sorteados", () => {
    expect(sumulaDisponivel({ status: "teams_drawn" })).toBe(true);
  });

  // Antes do sorteio não há lado para creditar gol; depois do encerramento a
  // correção é do /gerenciar. As duas pontas fecham o painel, e é esta função
  // que o link, a página e o iniciarJogo consultam — divergir daria link para
  // uma tela que redireciona de volta.
  it("fecha antes do sorteio e depois do encerramento", () => {
    expect(sumulaDisponivel({ status: "scheduled" })).toBe(false);
    expect(sumulaDisponivel({ status: "finished" })).toBe(false);
  });
});

describe("marcarPodeDesfazer", () => {
  // A lista chega do banco em ordem decrescente de id, mas a função não pode
  // depender disso: é o mesmo recorte do `not exists ... id > ...` do SQL.
  const lista = [
    { id: 4, side: "B" as const, desfeito: false },
    { id: 3, side: "A" as const, desfeito: false },
    { id: 2, side: "A" as const, desfeito: false },
    { id: 1, side: "B" as const, desfeito: true },
  ];

  const podem = (ehAdminDoFut: boolean) =>
    marcarPodeDesfazer(lista, ehAdminDoFut)
      .filter((l) => l.podeDesfazer)
      .map((l) => l.id)
      .sort((a, b) => a - b);

  it("delegado desfaz só o último ativo de cada lado", () => {
    expect(podem(false)).toEqual([3, 4]);
  });

  it("admin do fut desfaz qualquer lançamento ativo", () => {
    expect(podem(true)).toEqual([2, 3, 4]);
  });

  it("lançamento já desfeito nunca é desfazível de novo", () => {
    const marcados = marcarPodeDesfazer(lista, true);
    expect(marcados.find((l) => l.id === 1)?.podeDesfazer).toBe(false);
  });

  // Desfeito o último, o anterior VIRA o último ativo do lado — o desfazer em
  // cadeia é deliberado (ver o teste de integração), e a UI tem que oferecê-lo.
  it("desfeito o último do lado, o anterior assume", () => {
    const apos = [
      { id: 3, side: "A" as const, desfeito: true },
      { id: 2, side: "A" as const, desfeito: false },
    ];
    expect(marcarPodeDesfazer(apos, false).find((l) => l.id === 2)?.podeDesfazer).toBe(true);
  });

  it("não depende da ordem da lista", () => {
    const invertida = [...lista].reverse();
    expect(
      marcarPodeDesfazer(invertida, false)
        .filter((l) => l.podeDesfazer)
        .map((l) => l.id)
        .sort((a, b) => a - b),
    ).toEqual([3, 4]);
  });

  // Linha anterior à súmula não diz de que placar sair, e a action recusa —
  // então o botão não pode aparecer nem para o admin.
  it("lançamento sem lado não é desfazível por ninguém", () => {
    const semLado = [{ id: 9, side: null, desfeito: false }];
    expect(marcarPodeDesfazer(semLado, true)[0].podeDesfazer).toBe(false);
    expect(marcarPodeDesfazer(semLado, false)[0].podeDesfazer).toBe(false);
  });

  it("preserva os campos da linha original", () => {
    const [marcado] = marcarPodeDesfazer([{ id: 1, side: "A" as const, desfeito: false }], true);
    expect(marcado).toMatchObject({ id: 1, side: "A", desfeito: false, podeDesfazer: true });
  });
});

describe("montarLinhaDoTempo", () => {
  const gol = (id: number, criadoEm: number) => ({ id, criadoEm, autor: `gol ${id}` });
  const troca = (id: number, criadoEm: number) => ({ id, criadoEm, jogador: `troca ${id}` });

  it("intercala gols e trocas do mais recente para o mais antigo", () => {
    const linha = montarLinhaDoTempo(
      [gol(1, 100), gol(2, 300)],
      [troca(1, 200), troca(2, 400)],
    );

    expect(linha.map((e) => `${e.tipo}${e.id}`)).toEqual(["troca2", "gol2", "troca1", "gol1"]);
  });

  // O id não é relógio entre tabelas: as duas sequências correm separadas, e um
  // gol id 9 pode ser mais velho que uma troca id 1.
  it("ordena por criadoEm, não por id", () => {
    const linha = montarLinhaDoTempo([gol(9, 100)], [troca(1, 500)]);

    expect(linha.map((e) => e.tipo)).toEqual(["troca", "gol"]);
  });

  it("no mesmo instante, o gol vem antes da troca", () => {
    const linha = montarLinhaDoTempo([gol(1, 100)], [troca(1, 100)]);

    expect(linha.map((e) => e.tipo)).toEqual(["gol", "troca"]);
  });

  it("no mesmo instante e na mesma tabela, o id maior vem primeiro", () => {
    const linha = montarLinhaDoTempo([gol(1, 100), gol(2, 100)], []);

    expect(linha.map((e) => e.id)).toEqual([2, 1]);
  });

  it("listas vazias dão linha vazia", () => {
    expect(montarLinhaDoTempo([], [])).toEqual([]);
  });

  it("preserva os campos de cada lado da união", () => {
    const [primeiro] = montarLinhaDoTempo([], [troca(7, 10)]);

    expect(primeiro).toEqual({ tipo: "troca", id: 7, criadoEm: 10, jogador: "troca 7" });
  });
});

describe("tempoAtras", () => {
  it("menos de um minuto é 'agora'", () => {
    expect(tempoAtras(0)).toBe("agora");
    expect(tempoAtras(59)).toBe("agora");
  });

  it("minutos até a virada da hora", () => {
    expect(tempoAtras(60)).toBe("há 1 min");
    expect(tempoAtras(3599)).toBe("há 59 min");
  });

  it("passando de uma hora, os minutos vêm com dois dígitos", () => {
    expect(tempoAtras(3600)).toBe("há 1h00");
    expect(tempoAtras(3660)).toBe("há 1h01");
    expect(tempoAtras(7740)).toBe("há 2h09");
  });
});
