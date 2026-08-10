import { describe, expect, it } from "vitest";
import {
  listaFechada,
  ordenarPorChegada,
  proximoDaEspera,
  repartirLista,
  statusAoConfirmar,
  vagasLivres,
  type LinhaDaLista,
} from "./lista-presenca";

// Datas fixas: a ordem da lista não pode depender de quando o teste roda.
const T = (min: number) => new Date(2026, 7, 8, 20, min);

const linha = (
  playerId: number,
  status: LinhaDaLista["status"],
  minuto: number | null,
): LinhaDaLista => ({
  playerId,
  status,
  confirmedAt: minuto === null ? null : T(minuto),
});

// Fechar a lista é sortear os times: daí em diante quem mexe nela é o admin.
describe("listaFechada", () => {
  it("só a pelada marcada tem lista aberta", () => {
    expect(listaFechada("scheduled")).toBe(false);
    expect(listaFechada("teams_drawn")).toBe(true);
    expect(listaFechada("finished")).toBe(true);
  });
});

describe("ordenarPorChegada", () => {
  it("ordena por confirmedAt, não por id", () => {
    const linhas = [linha(3, "in", 10), linha(1, "in", 30), linha(2, "in", 20)];
    expect(ordenarPorChegada(linhas).map((l) => l.playerId)).toEqual([3, 2, 1]);
  });

  // Sem o desempate, a fila trocava de ordem entre dois renders da mesma tela —
  // e "o primeiro da espera" era um a cada recarga.
  it("desempata pelo id quando o instante é o mesmo", () => {
    const linhas = [linha(9, "in", 10), linha(4, "in", 10), linha(7, "in", 10)];
    expect(ordenarPorChegada(linhas).map((l) => l.playerId)).toEqual([4, 7, 9]);
  });

  it("quem não tem marco de entrada vai para o fim, não para o começo", () => {
    const linhas = [linha(1, "in", null), linha(2, "in", 30)];
    expect(ordenarPorChegada(linhas).map((l) => l.playerId)).toEqual([2, 1]);
  });

  // Dois nulos empatam em "sem marco" e caem no mesmo desempate por id dos
  // instantes iguais — sem ele, a ordem entre os dois mudaria a cada render.
  it("dois sem marco desempatam pelo id, atrás de quem tem marco", () => {
    const linhas = [linha(9, "in", null), linha(4, "in", null), linha(7, "in", 10)];
    expect(ordenarPorChegada(linhas).map((l) => l.playerId)).toEqual([7, 4, 9]);
  });

  it("não mexe no array recebido", () => {
    const linhas = [linha(2, "in", 30), linha(1, "in", 10)];
    ordenarPorChegada(linhas);
    expect(linhas.map((l) => l.playerId)).toEqual([2, 1]);
  });
});

describe("repartirLista", () => {
  it("separa os quatro estados, cada um na ordem de chegada", () => {
    const linhas = [
      linha(1, "in", 30),
      linha(2, "waitlist", 50),
      linha(3, "in", 10),
      linha(4, "out", 20),
      linha(5, "waitlist", 40),
      linha(6, "no_show", 15),
    ];
    const { vagas, espera, faltas, fora } = repartirLista(linhas);
    expect(vagas.map((l) => l.playerId)).toEqual([3, 1]);
    expect(espera.map((l) => l.playerId)).toEqual([5, 2]);
    expect(faltas.map((l) => l.playerId)).toEqual([6]);
    expect(fora.map((l) => l.playerId)).toEqual([4]);
  });

  // O caso legítimo de "mais gente dentro do que vagas": com a lista fechada o
  // admin inclui quem apareceu na quadra. Recalcular o corte pelo limite
  // rebaixaria essa gente para a espera na renderização seguinte.
  it("não rebaixa ninguém para a espera por conta própria", () => {
    const linhas = [linha(1, "in", 10), linha(2, "in", 20), linha(3, "in", 30)];
    expect(repartirLista(linhas).vagas).toHaveLength(3);
    expect(repartirLista(linhas).espera).toHaveLength(0);
  });

  it("lista vazia devolve as quatro partes vazias", () => {
    const { vagas, espera, faltas, fora } = repartirLista([]);
    expect([vagas, espera, faltas, fora].every((p) => p.length === 0)).toBe(true);
  });
});

describe("statusAoConfirmar", () => {
  it("sem limite, todo mundo entra", () => {
    expect(statusAoConfirmar(0, null)).toBe("in");
    expect(statusAoConfirmar(999, null)).toBe("in");
  });

  // O corte exato: com 2 vagas, quem chega com 1 ocupada ainda entra; quem chega
  // com 2 ocupadas espera. Um `<=` aqui deixaria a lista estourar em um.
  it("o último a caber entra, o próximo espera", () => {
    expect(statusAoConfirmar(1, 2)).toBe("in");
    expect(statusAoConfirmar(2, 2)).toBe("waitlist");
  });

  it("pelada lotada além do limite segue mandando para a espera", () => {
    expect(statusAoConfirmar(5, 2)).toBe("waitlist");
  });

  it("limite zero não abre vaga para ninguém", () => {
    expect(statusAoConfirmar(0, 0)).toBe("waitlist");
  });
});

describe("vagasLivres", () => {
  it("sem limite não há número a mostrar", () => {
    expect(vagasLivres(7, null)).toBeNull();
  });

  it("conta o que sobra", () => {
    expect(vagasLivres(3, 10)).toBe(7);
    expect(vagasLivres(10, 10)).toBe(0);
  });

  // "-2 vagas" na tela não quer dizer nada para quem está lendo.
  it("nunca fica negativo quando o admin inclui além do limite", () => {
    expect(vagasLivres(12, 10)).toBe(0);
  });
});

describe("proximoDaEspera", () => {
  it("sobe o primeiro da fila, não o primeiro do array", () => {
    const linhas = [
      linha(1, "in", 5),
      linha(2, "waitlist", 40),
      linha(3, "waitlist", 20),
    ];
    expect(proximoDaEspera(linhas)?.playerId).toBe(3);
  });

  it("sem ninguém esperando não há quem promover", () => {
    expect(proximoDaEspera([linha(1, "in", 5), linha(2, "out", null)])).toBeNull();
    expect(proximoDaEspera([])).toBeNull();
  });

  // Quem desistiu e quem faltou não voltam para a lista por uma vaga que abriu.
  it("ignora quem está fora e quem faltou", () => {
    const linhas = [linha(1, "out", null), linha(2, "no_show", 10), linha(3, "waitlist", 60)];
    expect(proximoDaEspera(linhas)?.playerId).toBe(3);
  });

  // Espera com marco e sem marco misturados: o nulo vai para o fim da fila —
  // chutar que chegou primeiro tomaria a vaga de quem estava esperando — mas
  // segue promovível quando é o único na espera.
  it("na espera, quem não tem marco perde a vez mas não a fila", () => {
    const misturada = [linha(1, "waitlist", null), linha(5, "waitlist", 30)];
    expect(proximoDaEspera(misturada)?.playerId).toBe(5);
    expect(proximoDaEspera([linha(1, "waitlist", null)])?.playerId).toBe(1);
  });
});
