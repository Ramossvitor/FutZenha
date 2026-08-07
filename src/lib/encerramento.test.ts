import { describe, expect, it } from "vitest";
import { montarChecklist } from "./encerramento";

const jogo = (ordem: number, ladoA: number, ladoB: number) => ({ ordem, ladoA, ladoB });
const chaves = (c: ReturnType<typeof montarChecklist>) => c.itens.map((i) => i.chave);
const item = (c: ReturnType<typeof montarChecklist>, chave: string) =>
  c.itens.find((i) => i.chave === chave)!;

describe("montarChecklist", () => {
  it("pelada redonda libera o encerramento", () => {
    const c = montarChecklist({
      jogos: [jogo(1, 5, 5), jogo(2, 5, 4)],
      avaliaveis: 10,
      comContaEmCampo: 10,
      semConta: [],
    });
    expect(c.podeEncerrar).toBe(true);
    expect(chaves(c)).toEqual(["jogos", "avaliacao"]);
    expect(item(c, "jogos").titulo).toBe("2 jogos lançados");
    expect(item(c, "avaliacao").titulo).toBe("10 contas ativas em campo");
  });

  it("lado vazio trava — é a mesma regra do confirmarEncerramento", () => {
    const c = montarChecklist({
      jogos: [jogo(1, 5, 5), jogo(2, 4, 0)],
      avaliaveis: 9,
      comContaEmCampo: 9,
      semConta: [],
    });
    expect(c.podeEncerrar).toBe(false);
    expect(item(c, "lado-vazio").titulo).toBe("O jogo 2 está com um lado vazio");
    expect(item(c, "lado-vazio").tom).toBe("alerta");
  });

  it("jogo sem nenhuma escalação também trava", () => {
    // o leftJoin do servidor devolve ladoA=0 e ladoB=0 para jogo sem ninguém;
    // filtrar esse caso antes esconderia o bloqueio de quem está na tela
    const c = montarChecklist({
      jogos: [jogo(1, 0, 0)],
      avaliaveis: 0,
      comContaEmCampo: 0,
      semConta: [],
    });
    expect(c.podeEncerrar).toBe(false);
  });

  it("junta vários jogos vazios numa frase só", () => {
    const c = montarChecklist({
      jogos: [jogo(1, 0, 3), jogo(2, 5, 5), jogo(3, 4, 0)],
      avaliaveis: 8,
      comContaEmCampo: 8,
      semConta: [],
    });
    expect(item(c, "lado-vazio").titulo).toBe("jogo 1 e jogo 3 estão com um lado vazio");
  });

  it("pelada sem jogo nenhum avisa, mas não trava", () => {
    const c = montarChecklist({ jogos: [], avaliaveis: 0, comContaEmCampo: 0, semConta: [] });
    expect(c.podeEncerrar).toBe(true);
    expect(item(c, "jogos").tom).toBe("alerta");
    expect(item(c, "jogos").titulo).toBe("Nenhum jogo lançado");
  });

  it("avisa quando a avaliação não vai valer para ninguém", () => {
    const c = montarChecklist({
      jogos: [jogo(1, 2, 2)],
      avaliaveis: 0,
      comContaEmCampo: 4,
      semConta: [],
    });
    expect(item(c, "avaliacao").tom).toBe("alerta");
    expect(item(c, "avaliacao").titulo).toBe("Ninguém vai ser avaliado");
    // continua liberado: a pelada vale para placar, artilharia e presença
    expect(c.podeEncerrar).toBe(true);
  });

  // O caso que o `avaliaveis` sozinho não conseguia contar: gruposElegiveis é
  // POR LADO, então um lado de 5 contas fecha o mínimo enquanto o de 2 não. A
  // tela não pode dizer "todo lado tem 3 ou mais" quando duas pessoas com conta
  // vão sair sem nota — encerrar é irreversível.
  it("um lado abaixo do mínimo vira alerta, não check verde", () => {
    const c = montarChecklist({
      jogos: [jogo(1, 5, 2)],
      avaliaveis: 5,
      comContaEmCampo: 7,
      semConta: [],
    });
    expect(item(c, "avaliacao").tom).toBe("alerta");
    expect(item(c, "avaliacao").titulo).toBe("5 contas ativas vão ser avaliadas");
    expect(item(c, "avaliacao").detalhe).toContain("2 contas ficaram");
    expect(item(c, "avaliacao").detalhe).not.toContain("Todo lado");
    // não trava: o lado pequeno joga, conta para placar, artilharia e presença
    expect(c.podeEncerrar).toBe(true);
  });

  it("concorda no singular quando é uma conta só que fica de fora", () => {
    const c = montarChecklist({
      jogos: [jogo(1, 3, 1)],
      avaliaveis: 3,
      comContaEmCampo: 4,
      semConta: [],
    });
    expect(item(c, "avaliacao").titulo).toBe("3 contas ativas vão ser avaliadas");
    expect(item(c, "avaliacao").detalhe).toContain("1 conta ficou");
  });

  it("quem está sem conta aparece pelo nome, no singular", () => {
    const c = montarChecklist({
      jogos: [jogo(1, 5, 5)],
      avaliaveis: 9,
      comContaEmCampo: 9,
      semConta: ["Magrão"],
    });
    expect(item(c, "sem-conta").titulo).toBe("Magrão está sem conta");
    expect(item(c, "sem-conta").tom).toBe("neutro");
  });

  it("vários sem conta viram contagem no título e nomes no detalhe", () => {
    const c = montarChecklist({
      jogos: [jogo(1, 5, 5)],
      avaliaveis: 8,
      comContaEmCampo: 8,
      semConta: ["Magrão", "Pituca", "Coxinha"],
    });
    expect(item(c, "sem-conta").titulo).toBe("3 jogadores estão sem conta");
    expect(item(c, "sem-conta").detalhe).toContain("Magrão, Pituca e Coxinha");
  });

  it("concorda no singular quando é um jogo só e uma conta só", () => {
    const c = montarChecklist({
      jogos: [jogo(1, 2, 1)],
      avaliaveis: 1,
      comContaEmCampo: 1,
      semConta: [],
    });
    expect(item(c, "jogos").titulo).toBe("1 jogo lançado");
    expect(item(c, "avaliacao").titulo).toBe("1 conta ativa em campo");
  });
});
