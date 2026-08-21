import { describe, expect, it } from "vitest";
import {
  avisoDeFutCriado,
  avisoDeFutEncerrado,
  avisoDeFutEncerradoNoGrupo,
  avisoDeTimesSorteados,
  avisoDeVespera,
} from "./avisos-fut";

// 2026-08-13 é quinta-feira — data fixa para o weekday não depender do relógio.
const fut = { id: 7, date: "2026-08-13", location: "Quadra do Zé" };

describe("avisos de fut", () => {
  it("dedupeKeys estáveis por fut — é o que torna cada evento idempotente", () => {
    expect(avisoDeFutCriado(fut, 3).dedupeKey).toBe("pelada:7:criada");
    expect(avisoDeTimesSorteados(fut, 3).dedupeKey).toBe("pelada:7:sorteada");
    expect(avisoDeVespera(fut, 3).dedupeKey).toBe("pelada:7:lembrete-vespera");
  });

  // O dedupeKey NÃO leva o playerId: a unique do banco é (playerId, dedupeKey),
  // então repetir a chave entre jogadores é correto — e mudá-la por jogador
  // quebraria o dedupe de nada.
  it("a mesma chave serve para jogadores diferentes", () => {
    expect(avisoDeVespera(fut, 3).dedupeKey).toBe(avisoDeVespera(fut, 8).dedupeKey);
  });

  it("todos apontam para a página do fut", () => {
    for (const aviso of [
      avisoDeFutCriado(fut, 3),
      avisoDeTimesSorteados(fut, 3),
      avisoDeVespera(fut, 3),
    ]) {
      expect(aviso.href).toBe("/fut/7");
      expect(aviso.playerId).toBe(3);
    }
  });

  it("dia e local no corpo — é o que a pessoa precisa para decidir sem abrir", () => {
    const aviso = avisoDeFutCriado(fut, 3);
    expect(aviso.body).toContain("13/08");
    expect(aviso.body).toContain("Quadra do Zé");
    expect(avisoDeVespera(fut, 3).body).toContain("Quadra do Zé");
  });

  it("cada evento tem o próprio type — a caixa de entrada distingue por ele", () => {
    expect(avisoDeFutCriado(fut, 3).type).toBe("pelada_criada");
    expect(avisoDeTimesSorteados(fut, 3).type).toBe("pelada_times_sorteados");
    expect(avisoDeVespera(fut, 3).type).toBe("pelada_lembrete_vespera");
  });
});

const AVALIANDO = { href: "/avaliar/12", podeAvaliar: true };
const SO_OLHANDO = { href: "/fut/7", podeAvaliar: false };

describe("avisos de encerramento", () => {
  // Mesmo guarda das chaves acima. Estas nascem com `fut:` porque nunca foram
  // gravadas — ver o cabeçalho de avisos-fut.ts antes de "consertar" o prefixo.
  it("dedupeKeys estáveis e literais", () => {
    expect(avisoDeFutEncerrado(fut, 3, AVALIANDO).dedupeKey).toBe("fut:7:encerrado");
    expect(avisoDeFutEncerradoNoGrupo(fut, 3).dedupeKey).toBe("fut:7:encerrado-grupo");
  });

  // A chave não muda com o destino: quem jogou recebe UM aviso do encerramento,
  // avalie ele ou não. Se mudasse, reprocessar entregaria os dois.
  it("a chave de quem jogou independe de ele avaliar ou não", () => {
    expect(avisoDeFutEncerrado(fut, 3, AVALIANDO).dedupeKey).toBe(
      avisoDeFutEncerrado(fut, 3, SO_OLHANDO).dedupeKey,
    );
  });

  it("os dois eventos são tipos diferentes — jogar não é a mesma notícia", () => {
    expect(avisoDeFutEncerrado(fut, 3, AVALIANDO).type).toBe("fut_encerrado");
    expect(avisoDeFutEncerradoNoGrupo(fut, 3).type).toBe("fut_encerrado_no_grupo");
  });

  it("o href de quem jogou vem de fora — é ele que evita o 404 de quem não avalia", () => {
    expect(avisoDeFutEncerrado(fut, 3, AVALIANDO).href).toBe("/avaliar/12");
    expect(avisoDeFutEncerrado(fut, 3, SO_OLHANDO).href).toBe("/fut/7");
    expect(avisoDeFutEncerradoNoGrupo(fut, 3).href).toBe("/fut/7");
  });

  it("só quem avalia é cobrado por isso, com o prazo no corpo", () => {
    const avaliador = avisoDeFutEncerrado(fut, 3, AVALIANDO);
    expect(avaliador.title).toContain("avalie");
    expect(avaliador.body).toContain("36 horas");

    const espectador = avisoDeFutEncerrado(fut, 3, SO_OLHANDO);
    expect(espectador.title).toBe("Fut encerrado");
    expect(espectador.body).not.toContain("avaliar");
  });

  // O placar NÃO entra no corpo: a linha nunca é reescrita e o placar é
  // corrigível por 24h. Ver o docstring de avisoDeFutEncerrado.
  it("o corpo leva a data, nunca o placar", () => {
    for (const aviso of [
      avisoDeFutEncerrado(fut, 3, AVALIANDO),
      avisoDeFutEncerrado(fut, 3, SO_OLHANDO),
    ]) {
      expect(aviso.body).toContain("13/08");
      expect(aviso.body).not.toMatch(/\d+\s*[x×]\s*\d+/i);
    }
  });

  it("quem não jogou recebe dia e local, para saber de que fut se fala", () => {
    const aviso = avisoDeFutEncerradoNoGrupo(fut, 3);
    expect(aviso.body).toContain("13/08");
    expect(aviso.body).toContain("Quadra do Zé");
    expect(aviso.playerId).toBe(3);
  });
});
