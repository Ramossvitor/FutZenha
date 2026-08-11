// As Server Actions de presença, do cookie de sessão ao commit: elegibilidade
// por escopo (grupo vs avulsa), a exceção da lista fechada, as promoções da
// espera com aviso e os slugs de recusa. Notificações são lidas direto da
// tabela — o aviso é parte do contrato de cada action.

import { afterEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  attendances,
  gamePlayers,
  games,
  groupMembers,
  invites,
  matchDays,
  notifications,
  players,
  teamPlayers,
  teams,
  type MatchDay,
  type Player,
} from "@/db/schema";
import { setMyAttendance } from "@/app/fut/[id]/actions";
import {
  convidarParaFut,
  definirPresenca,
  drawTeamsAction,
  marcarFalta,
  promoverDaEspera,
  updateMatchDay,
} from "@/app/fut/[id]/gerenciar/actions";
import { incluirNoJogo } from "@/app/fut/[id]/gerenciar/encerrar/actions";
import {
  confirmarPresenca,
  criarJogador,
  criarJogadorComConta,
  criarFut,
  logarComo,
} from "@/test/fixtures";
import { criarGrupo, entrarNoGrupo } from "@/test/fixtures-grupo";
import { esperaRedirect } from "@/test/navigation-fake";

/** Admin logado + fut criado por ele — o ponto de partida das actions de gestão. */
async function futComAdminLogado(
  extra: Partial<typeof matchDays.$inferInsert> = {},
): Promise<{ fut: MatchDay; admin: Player }> {
  const { jogador, conta } = await criarJogadorComConta();
  await logarComo(conta);
  const fut = await criarFut({ createdByPlayerId: jogador.id, ...extra });
  return { fut, admin: jogador };
}

async function linhaDe(fut: MatchDay, jogador: Player) {
  const [linha] = await db
    .select({ status: attendances.status })
    .from(attendances)
    .where(and(eq(attendances.matchDayId, fut.id), eq(attendances.playerId, jogador.id)));
  return linha ?? null;
}

const notificacoesDe = (jogador: Player) =>
  db.select().from(notifications).where(eq(notifications.playerId, jogador.id));

function formDoFut(campos: Partial<Record<string, string>> = {}): FormData {
  const form = new FormData();
  form.set("date", campos.date ?? "2026-08-12");
  form.set("startTime", campos.startTime ?? "");
  form.set("location", campos.location ?? "Quadra de Teste");
  form.set("notes", campos.notes ?? "");
  form.set("maxPlayers", campos.maxPlayers ?? "");
  return form;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("setMyAttendance", () => {
  it("fut de grupo: não-membro logado não grava nada", async () => {
    const groupId = await criarGrupo();
    const fut = await criarFut({ groupId });
    const { jogador, conta } = await criarJogadorComConta();
    await logarComo(conta);

    await setMyAttendance(fut.id, "in");

    expect(await linhaDe(fut, jogador)).toBeNull();
  });

  it("fut de grupo: membro entra na lista", async () => {
    const groupId = await criarGrupo();
    const fut = await criarFut({ groupId });
    const { jogador, conta } = await criarJogadorComConta();
    await entrarNoGrupo(groupId, jogador);
    await logarComo(conta);

    await setMyAttendance(fut.id, "in");

    expect((await linhaDe(fut, jogador))?.status).toBe("in");
  });

  it("fut avulso aceita qualquer jogador ativo", async () => {
    const fut = await criarFut();
    const { jogador, conta } = await criarJogadorComConta();
    await logarComo(conta);

    await setMyAttendance(fut.id, "in");

    expect((await linhaDe(fut, jogador))?.status).toBe("in");
  });

  it("ex-membro que já está no fut segue elegível", async () => {
    const groupId = await criarGrupo();
    const fut = await criarFut({ groupId });
    const { jogador, conta } = await criarJogadorComConta();
    await entrarNoGrupo(groupId, jogador);
    await confirmarPresenca(fut, jogador, { minutosAtras: 10 });
    await db
      .delete(groupMembers)
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.playerId, jogador.id)));
    await logarComo(conta);

    // A união com attendances do elegiveis.ts: sair do grupo não tranca quem
    // já está na lista para fora da própria presença.
    await setMyAttendance(fut.id, "out");

    expect((await linhaDe(fut, jogador))?.status).toBe("out");
  });

  it("lista fechada entre o render e a chamada: não grava", async () => {
    const fut = await criarFut();
    const { jogador, conta } = await criarJogadorComConta();
    await logarComo(conta);
    await db.update(matchDays).set({ status: "teams_drawn" }).where(eq(matchDays.id, fut.id));

    await setMyAttendance(fut.id, "in");

    expect(await linhaDe(fut, jogador)).toBeNull();
  });

  it("sair de vaga promove o primeiro da espera e o avisa", async () => {
    const fut = await criarFut({ maxPlayers: 2 });
    const { jogador: desistente, conta } = await criarJogadorComConta();
    const outroDono = await criarJogador();
    const daEspera = await criarJogador();
    await confirmarPresenca(fut, desistente, { minutosAtras: 30 });
    await confirmarPresenca(fut, outroDono, { minutosAtras: 20 });
    await confirmarPresenca(fut, daEspera, { status: "waitlist", minutosAtras: 10 });
    await logarComo(conta);

    await setMyAttendance(fut.id, "out");

    expect((await linhaDe(fut, daEspera))?.status).toBe("in");
    const avisos = await notificacoesDe(daEspera);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({
      type: "pelada_presenca_definida",
      dedupeKey: `espera-promovido:${fut.id}:${daEspera.id}`,
    });
  });
});

describe("definirPresenca", () => {
  it("lista aberta: alvo com conta ativa fora do fut é recusado", async () => {
    const { fut } = await futComAdminLogado();
    const alvo = await criarJogadorComConta();

    const url = await esperaRedirect(definirPresenca(fut.id, alvo.jogador.id, "in"));

    expect(url).toBe(`/fut/${fut.id}/gerenciar?erro=precisa-confirmar`);
    expect(await linhaDe(fut, alvo.jogador)).toBeNull();
    expect(await notificacoesDe(alvo.jogador)).toHaveLength(0);
  });

  it("lista fechada: elegível entra e é avisado no mesmo commit", async () => {
    const { fut } = await futComAdminLogado({ status: "teams_drawn" });
    const alvo = await criarJogadorComConta();

    await definirPresenca(fut.id, alvo.jogador.id, "in");

    expect((await linhaDe(fut, alvo.jogador))?.status).toBe("in");
    const avisos = await notificacoesDe(alvo.jogador);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({
      type: "pelada_presenca_definida",
      dedupeKey: `presenca:${fut.id}:${alvo.jogador.id}`,
    });
  });

  it("lista fechada: inelegível é recusado", async () => {
    const groupId = await criarGrupo();
    const { fut } = await futComAdminLogado({ groupId, status: "teams_drawn" });
    const alvo = await criarJogadorComConta();

    const url = await esperaRedirect(definirPresenca(fut.id, alvo.jogador.id, "in"));

    expect(url).toBe(`/fut/${fut.id}/gerenciar?erro=precisa-confirmar`);
    expect(await linhaDe(fut, alvo.jogador)).toBeNull();
  });
});

describe("promoverDaEspera e marcarFalta", () => {
  it("com a lista aberta, recusam sem gravar", async () => {
    const { fut } = await futComAdminLogado({ maxPlayers: 1 });
    const [dono, daEspera] = [await criarJogador(), await criarJogador()];
    await confirmarPresenca(fut, dono, { minutosAtras: 20 });
    await confirmarPresenca(fut, daEspera, { status: "waitlist", minutosAtras: 10 });

    expect(await esperaRedirect(promoverDaEspera(fut.id, daEspera.id))).toBe(
      `/fut/${fut.id}/gerenciar?erro=lista-aberta`,
    );
    expect(await esperaRedirect(marcarFalta(fut.id, dono.id, true))).toBe(
      `/fut/${fut.id}/gerenciar?erro=lista-aberta`,
    );

    expect((await linhaDe(fut, daEspera))?.status).toBe("waitlist");
    expect((await linhaDe(fut, dono))?.status).toBe("in");
  });

  it("playerId não-inteiro cai em dados-invalidos", async () => {
    const { fut } = await futComAdminLogado({ status: "teams_drawn" });

    expect(await esperaRedirect(promoverDaEspera(fut.id, 1.5))).toBe(
      `/fut/${fut.id}/gerenciar?erro=dados-invalidos`,
    );
    expect(await esperaRedirect(marcarFalta(fut.id, Number.NaN, true))).toBe(
      `/fut/${fut.id}/gerenciar?erro=dados-invalidos`,
    );
  });
});

describe("updateMatchDay", () => {
  it("subir o limite promove a espera em ordem e avisa cada promovido", async () => {
    const { fut } = await futComAdminLogado({ maxPlayers: 2 });
    const dentro = [await criarJogador(), await criarJogador()];
    const [primeiroDaFila, segundoDaFila] = [await criarJogador(), await criarJogador()];
    await confirmarPresenca(fut, dentro[0], { minutosAtras: 40 });
    await confirmarPresenca(fut, dentro[1], { minutosAtras: 30 });
    await confirmarPresenca(fut, primeiroDaFila, { status: "waitlist", minutosAtras: 20 });
    await confirmarPresenca(fut, segundoDaFila, { status: "waitlist", minutosAtras: 10 });

    await updateMatchDay(fut.id, formDoFut({ maxPlayers: "3" }));

    expect((await linhaDe(fut, primeiroDaFila))?.status).toBe("in");
    expect((await linhaDe(fut, segundoDaFila))?.status).toBe("waitlist");
    const avisos = await notificacoesDe(primeiroDaFila);
    expect(avisos).toHaveLength(1);
    expect(avisos[0].dedupeKey).toBe(`espera-promovido:${fut.id}:${primeiroDaFila.id}`);
    expect(await notificacoesDe(segundoDaFila)).toHaveLength(0);
  });
});

describe("drawTeamsAction", () => {
  it("sorteia só quem está dentro e fecha a lista", async () => {
    const { fut } = await futComAdminLogado();
    const dentro = [
      await criarJogador(),
      await criarJogador(),
      await criarJogador(),
      await criarJogador(),
    ];
    for (const [i, j] of dentro.entries()) {
      await confirmarPresenca(fut, j, { minutosAtras: 50 - i * 10 });
    }
    const daEspera = await criarJogador();
    const deFora = await criarJogador();
    await confirmarPresenca(fut, daEspera, { status: "waitlist", minutosAtras: 5 });
    await confirmarPresenca(fut, deFora, { status: "out" });

    const form = new FormData();
    form.set("teamCount", "2");
    const url = await esperaRedirect(drawTeamsAction(fut.id, form));

    expect(url).toBe(`/fut/${fut.id}/gerenciar`);
    const [depois] = await db.select().from(matchDays).where(eq(matchDays.id, fut.id));
    expect(depois.status).toBe("teams_drawn");

    const escalados = await db
      .select({ playerId: teamPlayers.playerId })
      .from(teamPlayers)
      .innerJoin(teams, eq(teamPlayers.teamId, teams.id))
      .where(eq(teams.matchDayId, fut.id));
    expect(escalados.map((e) => e.playerId).sort((a, b) => a - b)).toEqual(
      dentro.map((j) => j.id).sort((a, b) => a - b),
    );
  });

  it("avisa quem está na lista e tem conta — e o re-sorteio não repete o aviso", async () => {
    const { fut, admin } = await futComAdminLogado();
    const { jogador: comConta } = await criarJogadorComConta();
    const semConta = await criarJogador();
    await confirmarPresenca(fut, admin, { minutosAtras: 30 });
    await confirmarPresenca(fut, comConta, { minutosAtras: 20 });
    await confirmarPresenca(fut, semConta, { minutosAtras: 10 });

    const form = new FormData();
    form.set("teamCount", "2");
    await esperaRedirect(drawTeamsAction(fut.id, form));

    const avisos = await notificacoesDe(comConta);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({
      type: "pelada_times_sorteados",
      dedupeKey: `pelada:${fut.id}:sorteada`,
    });
    // Quem sorteou já sabe; quem não tem conta não tem onde ler.
    expect(await notificacoesDe(admin)).toHaveLength(0);
    expect(await notificacoesDe(semConta)).toHaveLength(0);

    // Re-sorteio é correção, não novidade: o dedupe segura o segundo aviso.
    await esperaRedirect(drawTeamsAction(fut.id, form));
    expect(await notificacoesDe(comConta)).toHaveLength(1);
  });
});

describe("convidarParaFut", () => {
  it("fut lotado com lista aberta: convidado cai na espera e o convite persiste", async () => {
    const { fut } = await futComAdminLogado({ maxPlayers: 2 });
    const dentro = [await criarJogador(), await criarJogador()];
    await confirmarPresenca(fut, dentro[0], { minutosAtras: 20 });
    await confirmarPresenca(fut, dentro[1], { minutosAtras: 10 });

    const form = new FormData();
    form.set("name", "Convidado da Espera");
    await convidarParaFut(fut.id, form);

    const [convidado] = await db
      .select()
      .from(players)
      .where(eq(players.name, "Convidado da Espera"));
    expect(convidado).toBeDefined();
    expect((await linhaDe(fut, convidado))?.status).toBe("waitlist");
    const [convite] = await db.select().from(invites).where(eq(invites.playerId, convidado.id));
    expect(convite).toMatchObject({ usedAt: null, email: null });
  });

  it("falha no envio do e-mail não desfaz jogador, convite nem presença", async () => {
    const { fut } = await futComAdminLogado({ maxPlayers: 2 });
    const dentro = [await criarJogador(), await criarJogador()];
    await confirmarPresenca(fut, dentro[0], { minutosAtras: 20 });
    await confirmarPresenca(fut, dentro[1], { minutosAtras: 10 });

    vi.stubEnv("RESEND_API_KEY", "re_test_fake");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("erro interno", { status: 500 })),
    );

    const form = new FormData();
    form.set("name", "Convidado Sem Email Entregue");
    form.set("email", "convidado@example.com");
    const url = await esperaRedirect(convidarParaFut(fut.id, form));

    // O envio fica fora da transação: falha de email vira banner, não rollback.
    expect(url).toBe(`/fut/${fut.id}/gerenciar?erro=email-nao-enviado`);
    const [convidado] = await db
      .select()
      .from(players)
      .where(eq(players.name, "Convidado Sem Email Entregue"));
    expect(convidado).toBeDefined();
    expect((await linhaDe(fut, convidado))?.status).toBe("waitlist");
    const [convite] = await db.select().from(invites).where(eq(invites.playerId, convidado.id));
    expect(convite).toMatchObject({ email: "convidado@example.com", emailSentAt: null });
  });
});

describe("incluirNoJogo", () => {
  it("quem estava como falta e é escalado volta a estar dentro", async () => {
    const { fut } = await futComAdminLogado({ status: "teams_drawn" });
    const faltoso = await criarJogador();
    await confirmarPresenca(fut, faltoso, { status: "no_show", minutosAtras: 10 });

    const [timeA] = await db
      .insert(teams)
      .values({ matchDayId: fut.id, name: "Preto", sortOrder: 0 })
      .returning();
    const [timeB] = await db
      .insert(teams)
      .values({ matchDayId: fut.id, name: "Branco", sortOrder: 1 })
      .returning();
    const [jogo] = await db
      .insert(games)
      .values({ matchDayId: fut.id, teamAId: timeA.id, teamBId: timeB.id })
      .returning();

    await incluirNoJogo(fut.id, jogo.id, "A", faltoso.id);

    const [escalado] = await db
      .select()
      .from(gamePlayers)
      .where(and(eq(gamePlayers.gameId, jogo.id), eq(gamePlayers.playerId, faltoso.id)));
    expect(escalado?.side).toBe("A");
    expect((await linhaDe(fut, faltoso))?.status).toBe("in");
  });
});
