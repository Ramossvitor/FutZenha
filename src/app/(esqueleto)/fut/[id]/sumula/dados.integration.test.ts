// A camada de leitura do painel. O alvo é a derivação que nenhuma action
// exercita: quem entra na lista de candidatos à delegação, o que o delegado
// NÃO enxerga, e o recorte dos lançamentos (desfeitos inclusive, gol do
// /gerenciar de fora).

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { addGoal } from "@/app/(esqueleto)/fut/[id]/gerenciar/actions";
import { db } from "@/db";
import { sumulaOperadores, users } from "@/db/schema";
import { confirmarPresenca, criarJogadorComConta } from "@/test/fixtures";
import { criarDelegado, formDeGol, formDeTimes, golsDoJogo, montarSumula } from "@/test/fixtures-sumula";
import { desfazerLancamento, iniciarJogo, lancarGol, trocarDeLado } from "./actions";
import { carregarSumula } from "./dados";

describe("carregarSumula: candidatos à delegação", () => {
  it("oferece só quem a delegarSumula aceitaria", async () => {
    const s = await montarSumula();
    const elegivel = await criarJogadorComConta();
    await confirmarPresenca(s.fut, elegivel.jogador, { minutosAtras: 10 });

    // Fora da lista, na espera, e com a conta desativada — os três casos que a
    // action recusa, e que o select não pode oferecer.
    const semPresenca = await criarJogadorComConta();
    const naEspera = await criarJogadorComConta();
    await confirmarPresenca(s.fut, naEspera.jogador, { status: "waitlist", minutosAtras: 5 });
    const desativado = await criarJogadorComConta();
    await confirmarPresenca(s.fut, desativado.jogador, { minutosAtras: 8 });
    await db.update(users).set({ active: false }).where(eq(users.id, desativado.conta.id));

    const dados = await carregarSumula(s.fut, true);
    const ids = dados.candidatos.map((c) => c.playerId);

    expect(ids).toEqual([elegivel.jogador.id]);
    for (const fora of [semPresenca, naEspera, desativado]) {
      expect(ids).not.toContain(fora.jogador.id);
    }
  });

  it("quem já tem a súmula sai da lista de candidatos", async () => {
    const s = await montarSumula();
    const delegado = await criarDelegado(s.fut);

    const dados = await carregarSumula(s.fut, true);

    expect(dados.operadores.map((o) => o.playerId)).toEqual([delegado.jogador.id]);
    expect(dados.candidatos.map((c) => c.playerId)).not.toContain(delegado.jogador.id);
  });

  it("o criador do fut não é candidato a receber a própria súmula", async () => {
    const s = await montarSumula();
    await confirmarPresenca(s.fut, s.admin, { minutosAtras: 30 });

    const dados = await carregarSumula(s.fut, true);

    expect(dados.candidatos.map((c) => c.playerId)).not.toContain(s.admin.id);
  });

  it("delegado não recebe a lista de candidatos", async () => {
    const s = await montarSumula();
    const elegivel = await criarJogadorComConta();
    await confirmarPresenca(s.fut, elegivel.jogador, { minutosAtras: 10 });

    const dados = await carregarSumula(s.fut, false);

    expect(dados.candidatos).toEqual([]);
  });

  it("traz quem passou a súmula, para a auditoria da seção", async () => {
    const s = await montarSumula();
    const alvo = await criarJogadorComConta();
    await confirmarPresenca(s.fut, alvo.jogador, { minutosAtras: 10 });
    await db
      .insert(sumulaOperadores)
      .values({ matchDayId: s.fut.id, playerId: alvo.jogador.id, createdByPlayerId: s.admin.id });

    const dados = await carregarSumula(s.fut, true);

    expect(dados.operadores[0]).toMatchObject({ playerId: alvo.jogador.id, delegadoPor: s.admin.name });
  });
});

describe("carregarSumula: o jogo aberto e seus lançamentos", () => {
  it("acha o jogo em andamento e monta a escalação por lado", async () => {
    const s = await montarSumula();
    await iniciarJogo(s.fut.id, formDeTimes(s.timeAId, s.timeBId));

    const dados = await carregarSumula(s.fut, true);

    expect(dados.aberto).not.toBeNull();
    expect(dados.aberto?.segundosEmAndamento).not.toBeNull();
    expect(dados.lineupRows.filter((m) => m.side === "A").map((m) => m.playerId).sort()).toEqual(
      s.ladoA.map((p) => p.id).sort(),
    );
    expect(dados.lineupRows.filter((m) => m.side === "B")).toHaveLength(2);
  });

  // A auditoria visível é metade do desenho anti-abuso: o desfeito FICA na
  // lista, riscado, com o nome de quem desfez.
  it("lista os desfeitos junto com os ativos, do mais recente ao mais antigo", async () => {
    const s = await montarSumula();
    await iniciarJogo(s.fut.id, formDeTimes(s.timeAId, s.timeBId));
    const abertoId = (await carregarSumula(s.fut, true)).aberto!.id;
    await lancarGol(s.fut.id, abertoId, formDeGol("A", s.ladoA[0].id));
    await lancarGol(s.fut.id, abertoId, formDeGol("B"));
    const gols = await golsDoJogo(abertoId);
    await desfazerLancamento(s.fut.id, gols[1].id);

    const dados = await carregarSumula(s.fut, true);

    expect(dados.lancamentoRows.map((l) => l.id)).toEqual([gols[1].id, gols[0].id]);
    expect(dados.lancamentoRows[0]).toMatchObject({
      desfeito: true,
      desfeitoPor: s.admin.name,
      // Gol contra / sem autor: sem autor, mas com lado.
      autorNome: null,
      side: "B",
    });
    expect(dados.lancamentoRows[1]).toMatchObject({ desfeito: false, lancadoPor: s.admin.name });
    // NÚMERO, não string: é o que ordena a linha do tempo contra as trocas, e
    // `extract(epoch ...)` sem cast chega como numeric — string no driver.
    expect(typeof dados.lancamentoRows[0].criadoEm).toBe("number");
  });

  it("gol lançado pelo /gerenciar fica fora do painel", async () => {
    const s = await montarSumula();
    await iniciarJogo(s.fut.id, formDeTimes(s.timeAId, s.timeBId));
    const abertoId = (await carregarSumula(s.fut, true)).aberto!.id;
    await lancarGol(s.fut.id, abertoId, formDeGol("A", s.ladoA[0].id));

    const form = new FormData();
    form.set("playerId", String(s.ladoA[1].id));
    await addGoal(s.fut.id, abertoId, form);

    const dados = await carregarSumula(s.fut, true);

    expect(await golsDoJogo(abertoId)).toHaveLength(2);
    expect(dados.lancamentoRows).toHaveLength(1);
  });

  it("sem jogo em andamento, não há lançamento nem escalação para mostrar", async () => {
    const s = await montarSumula();

    const dados = await carregarSumula(s.fut, true);

    expect(dados.aberto).toBeNull();
    expect(dados.lancamentoRows).toEqual([]);
    expect(dados.lineupRows).toEqual([]);
    expect(dados.trocaRows).toEqual([]);
  });

  it("traz as trocas de lado com o jogador, o operador e o carimbo", async () => {
    const s = await montarSumula();
    await iniciarJogo(s.fut.id, formDeTimes(s.timeAId, s.timeBId));
    const abertoId = (await carregarSumula(s.fut, true)).aberto!.id;
    const trocado = s.ladoA[0];

    await trocarDeLado(s.fut.id, abertoId, trocado.id);

    const dados = await carregarSumula(s.fut, true);

    expect(dados.trocaRows).toHaveLength(1);
    expect(dados.trocaRows[0]).toMatchObject({
      playerId: trocado.id,
      de: "A",
      para: "B",
      jogadorNome: trocado.name,
      porNome: s.admin.name,
    });
    // O `criadoEm` é o que a linha do tempo usa para intercalar com os gols —
    // epoch do Postgres, e não o relógio da aplicação.
    expect(dados.trocaRows[0].criadoEm).toBeGreaterThan(0);
    // E a escalação do painel já mostra o jogador do lado novo.
    expect(dados.lineupRows.find((m) => m.playerId === trocado.id)?.side).toBe("B");
  });

  // Ida e volta: as duas linhas ficam, da mais recente para a mais antiga (é a
  // ordem em que o painel monta a linha do tempo).
  it("lista as trocas do jogo aberto, da mais recente para a mais antiga", async () => {
    const s = await montarSumula();
    await iniciarJogo(s.fut.id, formDeTimes(s.timeAId, s.timeBId));
    const abertoId = (await carregarSumula(s.fut, true)).aberto!.id;
    await trocarDeLado(s.fut.id, abertoId, s.ladoA[0].id);
    await trocarDeLado(s.fut.id, abertoId, s.ladoA[0].id);

    const dados = await carregarSumula(s.fut, true);

    expect(dados.trocaRows.map((t) => `${t.de}${t.para}`)).toEqual(["BA", "AB"]);
  });
});
