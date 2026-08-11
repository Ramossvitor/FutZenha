// createMatchDay do cookie ao commit, com foco no aviso "fut marcado": vai
// para os elegíveis com conta ativa, respeita o escopo (grupo vs avulsa) e
// nunca avisa quem marcou. A notificação é lida direto da tabela — o aviso é
// parte do contrato da action, como nos testes de presença.

import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { matchDays, notifications, type Player } from "@/db/schema";
import { createMatchDay } from "@/app/futs/novo/actions";
import { criarJogador, criarJogadorComConta, logarComo } from "@/test/fixtures";
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
  it("fut avulso avisa todo jogador ativo com conta, menos quem marcou", async () => {
    const { jogador: criador, conta } = await criarJogadorComConta();
    const { jogador: colega } = await criarJogadorComConta();
    const semConta = await criarJogador();
    const { jogador: desativado } = await criarJogadorComConta({ active: false });
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
    expect(await notificacoesDe(criador)).toHaveLength(0);
    expect(await notificacoesDe(semConta)).toHaveLength(0);
    expect(await notificacoesDe(desativado)).toHaveLength(0);
  });

  it("fut de grupo avisa só os membros — sem vazar para a plataforma", async () => {
    const { jogador: criador, conta } = await criarJogadorComConta();
    const { jogador: doGrupo } = await criarJogadorComConta();
    const { jogador: deFora } = await criarJogadorComConta();
    const groupId = await criarGrupo();
    await entrarNoGrupo(groupId, criador, "admin");
    await entrarNoGrupo(groupId, doGrupo);
    await logarComo(conta);

    await esperaRedirect(createMatchDay(formDeFut({ groupId: String(groupId) })));

    expect(await notificacoesDe(doGrupo)).toHaveLength(1);
    expect(await notificacoesDe(deFora)).toHaveLength(0);
    expect(await notificacoesDe(criador)).toHaveLength(0);
  });
});
