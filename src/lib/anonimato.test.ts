import { describe, expect, it } from "vitest";
import { ordenarAnonimo } from "./anonimato";

const av = (ratingId: number, stars: number) => ({ ratingId, stars });

describe("ordenarAnonimo", () => {
  it("lista vazia continua vazia", () => {
    expect(ordenarAnonimo([])).toEqual([]);
  });

  it("ordena da maior nota para a menor", () => {
    const r = ordenarAnonimo([av(1, 2), av(2, 5), av(3, 3)]);
    expect(r.map((x) => x.stars)).toEqual([5, 3, 2]);
  });

  it("não muda o array recebido", () => {
    const original = [av(1, 1), av(2, 5)];
    ordenarAnonimo(original);
    expect(original.map((x) => x.ratingId)).toEqual([1, 2]);
  });

  it("é estável: a mesma entrada dá sempre a mesma ordem", () => {
    const entrada = [av(10, 4), av(11, 4), av(12, 4), av(13, 4)];
    const a = ordenarAnonimo(entrada).map((x) => x.ratingId);
    const b = ordenarAnonimo([...entrada].reverse()).map((x) => x.ratingId);
    expect(b).toEqual(a);
  });

  // O ponto do módulo: empate de nota não pode sair na ordem de envio, porque
  // `ratings.id` é serial e entregaria quem avaliou primeiro.
  it("com notas empatadas, não devolve na ordem dos ids", () => {
    const ids = [1, 2, 3, 4, 5, 6, 7, 8];
    const r = ordenarAnonimo(ids.map((id) => av(id, 3))).map((x) => x.ratingId);
    expect(r).not.toEqual(ids);
    expect([...r].sort((a, b) => a - b)).toEqual(ids);
  });

  it("desempate não é crescente nem decrescente por id", () => {
    const r = ordenarAnonimo([1, 2, 3, 4, 5, 6].map((id) => av(id, 5))).map((x) => x.ratingId);
    const crescente = r.every((v, i) => i === 0 || r[i - 1] < v);
    const decrescente = r.every((v, i) => i === 0 || r[i - 1] > v);
    expect(crescente || decrescente).toBe(false);
  });

  it("preserva os campos extras de cada avaliação", () => {
    const r = ordenarAnonimo([
      { ratingId: 1, stars: 2, reportada: true },
      { ratingId: 2, stars: 5, reportada: false },
    ]);
    expect(r[0]).toEqual({ ratingId: 2, stars: 5, reportada: false });
  });

  it("a nota manda sobre o embaralhamento", () => {
    const r = ordenarAnonimo([av(999, 1), av(1, 5)]);
    expect(r.map((x) => x.stars)).toEqual([5, 1]);
  });
});
