// createMatchDay do cookie ao commit, com foco no aviso "fut marcado": vai
// para os elegíveis com conta ativa, respeita o escopo (grupo vs avulsa) e
// nunca avisa quem marcou. A notificação é lida direto da tabela — o aviso é
// parte do contrato da action, como nos testes de presença.

import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { matchDays, notifications, type Player } from "@/db/schema";
import { createMatchDay } from "@/app/futs/novo/actions";
import {
  confirmarPresenca,
  criarFut,
  criarJogador,
  criarJogadorComConta,
  logarComo,
} from "@/test/fixtures";
import { criarGrupo, entrarNoGrupo } from "@/test/fixtures-grupo";
import { esperaRedirect } from "@/test/navigation-fake";

function formDeFut(campos: Partial<Record<string, string>> = {}): FormData {
  const form = new FormData();
  form.set("date", campos.date ?? "2026-08-20");
  form.set("startTime", campos.startTime ?? "");
  form.set("location", campos.location ?? "Quadra Nova");
  form.set("notes", campos.notes ?? "");
  form.set("maxPlayers", campos.maxPlayers ?? "");
  if (campos.groupId !== undefined) form.set("groupId", campos.groupId);
  return form;
}

const notificacoesDe = (jogador: Player) =>
  db.select().from(notifications).where(eq(notifications.playerId, jogador.id));

async function futCriado(url: string) {
  const id = Number(url.match(/\/fut\/(\d+)\//)?.[1]);
  const [fut] = await db.select().from(matchDays).where(eq(matchDays.id, id));
  return fut;
}

describe("createMatchDay — aviso de fut marcado", () => {
  // O alcance do fut avulso é quem JÁ JOGOU com quem marca — não a plataforma.
  //
  // Antes, `condicaoElegivel` devolvia `undefined` para fut sem grupo e o
  // `and()` do drizzle descartava o termo em silêncio: todo jogador ativo com
  // conta recebia notificação e push a cada fut avulso criado por qualquer
  // pessoa, sem teto de criação nenhum. Era um megafone de graça.
  it("fut avulso avisa quem já jogou com quem marcou — e mais ninguém", async () => {
    const { jogador: criador, conta } = await criarJogadorComConta();
    const { jogador: colega } = await criarJogadorComConta();
    const { jogador: estranho } = await criarJogadorComConta();
    const semConta = await criarJogador();
    const { jogador: desativado } = await criarJogadorComConta({ active: false });

    // O histórico que cria a relação: os dois dividiram um fut anterior.
    const anterior = await criarFut({ date: "2026-01-10" });
    await confirmarPresenca(anterior, criador);
    await confirmarPresenca(anterior, colega);
    // `desativado` também jogou junto — o filtro de conta ativa é outro, e tem
    // de continuar valendo por cima deste.
    await confirmarPresenca(anterior, desativado);
    await confirmarPresenca(anterior, semConta);

    await logarComo(conta);
    const url = await esperaRedirect(createMatchDay(formDeFut()));
    const fut = await futCriado(url);

    const avisos = await notificacoesDe(colega);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({
      type: "pelada_criada",
      dedupeKey: `pelada:${fut.id}:criada`,
      href: `/fut/${fut.id}`,
    });
    // O estranho nunca dividiu fut com quem marcou: não é avisado.
    expect(await notificacoesDe(estranho)).toHaveLength(0);
    expect(await notificacoesDe(criador)).toHaveLength(0);
    expect(await notificacoesDe(semConta)).toHaveLength(0);
    expect(await notificacoesDe(desativado)).toHaveLength(0);
  });

  // Conta nova, sem histórico nenhum: o primeiro fut avulso dela não interrompe
  // ninguém. É o caso que fechava o megafone — criar conta e marcar fut era o
  // caminho mais barato para alcançar a plataforma inteira.
  it("quem nunca jogou com ninguém não avisa ninguém", async () => {
    const { conta } = await criarJogadorComConta();
    const { jogador: outro } = await criarJogadorComConta();
    await logarComo(conta);

    await esperaRedirect(createMatchDay(formDeFut()));

    expect(await notificacoesDe(outro)).toHaveLength(0);
  });

  it("fut de grupo avisa só os membros — sem vazar para a plataforma", async () => {
    const { jogador: criador, conta } = await criarJogadorComConta();
    const { jogador: doGrupo } = await criarJogadorComConta();
    const { jogador: deFora } = await criarJogadorComConta();
    const groupId = (await criarGrupo()).id;
    await entrarNoGrupo(groupId, criador, "admin");
    await entrarNoGrupo(groupId, doGrupo);
    await logarComo(conta);

    await esperaRedirect(createMatchDay(formDeFut({ groupId: String(groupId) })));

    expect(await notificacoesDe(doGrupo)).toHaveLength(1);
    expect(await notificacoesDe(deFora)).toHaveLength(0);
    expect(await notificacoesDe(criador)).toHaveLength(0);
  });
});
