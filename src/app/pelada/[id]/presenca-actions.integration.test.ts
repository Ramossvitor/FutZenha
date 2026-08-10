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
import { setMyAttendance } from "@/app/pelada/[id]/actions";
import {
  convidarParaPelada,
  definirPresenca,
  drawTeamsAction,
  marcarFalta,
  promoverDaEspera,
  updateMatchDay,
} from "@/app/pelada/[id]/gerenciar/actions";
import { incluirNoJogo } from "@/app/pelada/[id]/gerenciar/encerrar/actions";
import {
  confirmarPresenca,
  criarJogador,
  criarJogadorComConta,
  criarPelada,
  logarComo,
} from "@/test/fixtures";
import { criarGrupo, entrarNoGrupo } from "@/test/fixtures-grupo";
import { esperaRedirect } from "@/test/navigation-fake";

/** Admin logado + pelada criada por ele — o ponto de partida das actions de gestão. */
async function peladaComAdminLogado(
  extra: Partial<typeof matchDays.$inferInsert> = {},
): Promise<{ pelada: MatchDay; admin: Player }> {
  const { jogador, conta } = await criarJogadorComConta();
  await logarComo(conta);
  const pelada = await criarPelada({ createdByPlayerId: jogador.id, ...extra });
  return { pelada, admin: jogador };
}

async function linhaDe(pelada: MatchDay, jogador: Player) {
  const [linha] = await db
    .select({ status: attendances.status })
    .from(attendances)
    .where(and(eq(attendances.matchDayId, pelada.id), eq(attendances.playerId, jogador.id)));
  return linha ?? null;
}

const notificacoesDe = (jogador: Player) =>
  db.select().from(notifications).where(eq(notifications.playerId, jogador.id));

function formDaPelada(campos: Partial<Record<string, string>> = {}): FormData {
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
  it("pelada de grupo: não-membro logado não grava nada", async () => {
    const groupId = await criarGrupo();
    const pelada = await criarPelada({ groupId });
    const { jogador, conta } = await criarJogadorComConta();
    await logarComo(conta);

    await setMyAttendance(pelada.id, "in");

    expect(await linhaDe(pelada, jogador)).toBeNull();
  });

  it("pelada de grupo: membro entra na lista", async () => {
    const groupId = await criarGrupo();
    const pelada = await criarPelada({ groupId });
    const { jogador, conta } = await criarJogadorComConta();
    await entrarNoGrupo(groupId, jogador);
    await logarComo(conta);

    await setMyAttendance(pelada.id, "in");

    expect((await linhaDe(pelada, jogador))?.status).toBe("in");
  });

  it("pelada avulsa aceita qualquer jogador ativo", async () => {
    const pelada = await criarPelada();
    const { jogador, conta } = await criarJogadorComConta();
    await logarComo(conta);

    await setMyAttendance(pelada.id, "in");

    expect((await linhaDe(pelada, jogador))?.status).toBe("in");
  });

  it("ex-membro que já está na pelada segue elegível", async () => {
    const groupId = await criarGrupo();
    const pelada = await criarPelada({ groupId });
    const { jogador, conta } = await criarJogadorComConta();
    await entrarNoGrupo(groupId, jogador);
    await confirmarPresenca(pelada, jogador, { minutosAtras: 10 });
    await db
      .delete(groupMembers)
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.playerId, jogador.id)));
    await logarComo(conta);

    // A união com attendances do elegiveis.ts: sair do grupo não tranca quem
    // já está na lista para fora da própria presença.
    await setMyAttendance(pelada.id, "out");

    expect((await linhaDe(pelada, jogador))?.status).toBe("out");
  });

  it("lista fechada entre o render e a chamada: não grava", async () => {
    const pelada = await criarPelada();
    const { jogador, conta } = await criarJogadorComConta();
    await logarComo(conta);
    await db.update(matchDays).set({ status: "teams_drawn" }).where(eq(matchDays.id, pelada.id));

    await setMyAttendance(pelada.id, "in");

    expect(await linhaDe(pelada, jogador)).toBeNull();
  });

  it("sair de vaga promove o primeiro da espera e o avisa", async () => {
    const pelada = await criarPelada({ maxPlayers: 2 });
    const { jogador: desistente, conta } = await criarJogadorComConta();
    const outroDono = await criarJogador();
    const daEspera = await criarJogador();
    await confirmarPresenca(pelada, desistente, { minutosAtras: 30 });
    await confirmarPresenca(pelada, outroDono, { minutosAtras: 20 });
    await confirmarPresenca(pelada, daEspera, { status: "waitlist", minutosAtras: 10 });
    await logarComo(conta);

    await setMyAttendance(pelada.id, "out");

    expect((await linhaDe(pelada, daEspera))?.status).toBe("in");
    const avisos = await notificacoesDe(daEspera);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({
      type: "pelada_presenca_definida",
      dedupeKey: `espera-promovido:${pelada.id}:${daEspera.id}`,
    });
  });
});

describe("definirPresenca", () => {
  it("lista aberta: alvo com conta ativa fora da pelada é recusado", async () => {
    const { pelada } = await peladaComAdminLogado();
    const alvo = await criarJogadorComConta();

    const url = await esperaRedirect(definirPresenca(pelada.id, alvo.jogador.id, "in"));

    expect(url).toBe(`/pelada/${pelada.id}/gerenciar?erro=precisa-confirmar`);
    expect(await linhaDe(pelada, alvo.jogador)).toBeNull();
    expect(await notificacoesDe(alvo.jogador)).toHaveLength(0);
  });

  it("lista fechada: elegível entra e é avisado no mesmo commit", async () => {
    const { pelada } = await peladaComAdminLogado({ status: "teams_drawn" });
    const alvo = await criarJogadorComConta();

    await definirPresenca(pelada.id, alvo.jogador.id, "in");

    expect((await linhaDe(pelada, alvo.jogador))?.status).toBe("in");
    const avisos = await notificacoesDe(alvo.jogador);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({
      type: "pelada_presenca_definida",
      dedupeKey: `presenca:${pelada.id}:${alvo.jogador.id}`,
    });
  });

  it("lista fechada: inelegível é recusado", async () => {
    const groupId = await criarGrupo();
    const { pelada } = await peladaComAdminLogado({ groupId, status: "teams_drawn" });
    const alvo = await criarJogadorComConta();

    const url = await esperaRedirect(definirPresenca(pelada.id, alvo.jogador.id, "in"));

    expect(url).toBe(`/pelada/${pelada.id}/gerenciar?erro=precisa-confirmar`);
    expect(await linhaDe(pelada, alvo.jogador)).toBeNull();
  });
});

describe("promoverDaEspera e marcarFalta", () => {
  it("com a lista aberta, recusam sem gravar", async () => {
    const { pelada } = await peladaComAdminLogado({ maxPlayers: 1 });
    const [dono, daEspera] = [await criarJogador(), await criarJogador()];
    await confirmarPresenca(pelada, dono, { minutosAtras: 20 });
    await confirmarPresenca(pelada, daEspera, { status: "waitlist", minutosAtras: 10 });

    expect(await esperaRedirect(promoverDaEspera(pelada.id, daEspera.id))).toBe(
      `/pelada/${pelada.id}/gerenciar?erro=lista-aberta`,
    );
    expect(await esperaRedirect(marcarFalta(pelada.id, dono.id, true))).toBe(
      `/pelada/${pelada.id}/gerenciar?erro=lista-aberta`,
    );

    expect((await linhaDe(pelada, daEspera))?.status).toBe("waitlist");
    expect((await linhaDe(pelada, dono))?.status).toBe("in");
  });

  it("playerId não-inteiro cai em dados-invalidos", async () => {
    const { pelada } = await peladaComAdminLogado({ status: "teams_drawn" });

    expect(await esperaRedirect(promoverDaEspera(pelada.id, 1.5))).toBe(
      `/pelada/${pelada.id}/gerenciar?erro=dados-invalidos`,
    );
    expect(await esperaRedirect(marcarFalta(pelada.id, Number.NaN, true))).toBe(
      `/pelada/${pelada.id}/gerenciar?erro=dados-invalidos`,
    );
  });
});

describe("updateMatchDay", () => {
  it("subir o limite promove a espera em ordem e avisa cada promovido", async () => {
    const { pelada } = await peladaComAdminLogado({ maxPlayers: 2 });
    const dentro = [await criarJogador(), await criarJogador()];
    const [primeiroDaFila, segundoDaFila] = [await criarJogador(), await criarJogador()];
    await confirmarPresenca(pelada, dentro[0], { minutosAtras: 40 });
    await confirmarPresenca(pelada, dentro[1], { minutosAtras: 30 });
    await confirmarPresenca(pelada, primeiroDaFila, { status: "waitlist", minutosAtras: 20 });
    await confirmarPresenca(pelada, segundoDaFila, { status: "waitlist", minutosAtras: 10 });

    await updateMatchDay(pelada.id, formDaPelada({ maxPlayers: "3" }));

    expect((await linhaDe(pelada, primeiroDaFila))?.status).toBe("in");
    expect((await linhaDe(pelada, segundoDaFila))?.status).toBe("waitlist");
    const avisos = await notificacoesDe(primeiroDaFila);
    expect(avisos).toHaveLength(1);
    expect(avisos[0].dedupeKey).toBe(`espera-promovido:${pelada.id}:${primeiroDaFila.id}`);
    expect(await notificacoesDe(segundoDaFila)).toHaveLength(0);
  });
});

describe("drawTeamsAction", () => {
  it("sorteia só quem está dentro e fecha a lista", async () => {
    const { pelada } = await peladaComAdminLogado();
    const dentro = [
      await criarJogador(),
      await criarJogador(),
      await criarJogador(),
      await criarJogador(),
    ];
    for (const [i, j] of dentro.entries()) {
      await confirmarPresenca(pelada, j, { minutosAtras: 50 - i * 10 });
    }
    const daEspera = await criarJogador();
    const deFora = await criarJogador();
    await confirmarPresenca(pelada, daEspera, { status: "waitlist", minutosAtras: 5 });
    await confirmarPresenca(pelada, deFora, { status: "out" });

    const form = new FormData();
    form.set("teamCount", "2");
    const url = await esperaRedirect(drawTeamsAction(pelada.id, form));

    expect(url).toBe(`/pelada/${pelada.id}/gerenciar`);
    const [depois] = await db.select().from(matchDays).where(eq(matchDays.id, pelada.id));
    expect(depois.status).toBe("teams_drawn");

    const escalados = await db
      .select({ playerId: teamPlayers.playerId })
      .from(teamPlayers)
      .innerJoin(teams, eq(teamPlayers.teamId, teams.id))
      .where(eq(teams.matchDayId, pelada.id));
    expect(escalados.map((e) => e.playerId).sort((a, b) => a - b)).toEqual(
      dentro.map((j) => j.id).sort((a, b) => a - b),
    );
  });
});

describe("convidarParaPelada", () => {
  it("pelada lotada com lista aberta: convidado cai na espera e o convite persiste", async () => {
    const { pelada } = await peladaComAdminLogado({ maxPlayers: 2 });
    const dentro = [await criarJogador(), await criarJogador()];
    await confirmarPresenca(pelada, dentro[0], { minutosAtras: 20 });
    await confirmarPresenca(pelada, dentro[1], { minutosAtras: 10 });

    const form = new FormData();
    form.set("name", "Convidado da Espera");
    await convidarParaPelada(pelada.id, form);

    const [convidado] = await db
      .select()
      .from(players)
      .where(eq(players.name, "Convidado da Espera"));
    expect(convidado).toBeDefined();
    expect((await linhaDe(pelada, convidado))?.status).toBe("waitlist");
    const [convite] = await db.select().from(invites).where(eq(invites.playerId, convidado.id));
    expect(convite).toMatchObject({ usedAt: null, email: null });
  });

  it("falha no envio do e-mail não desfaz jogador, convite nem presença", async () => {
    const { pelada } = await peladaComAdminLogado({ maxPlayers: 2 });
    const dentro = [await criarJogador(), await criarJogador()];
    await confirmarPresenca(pelada, dentro[0], { minutosAtras: 20 });
    await confirmarPresenca(pelada, dentro[1], { minutosAtras: 10 });

    vi.stubEnv("RESEND_API_KEY", "re_test_fake");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("erro interno", { status: 500 })),
    );

    const form = new FormData();
    form.set("name", "Convidado Sem Email Entregue");
    form.set("email", "convidado@example.com");
    const url = await esperaRedirect(convidarParaPelada(pelada.id, form));

    // O envio fica fora da transação: falha de email vira banner, não rollback.
    expect(url).toBe(`/pelada/${pelada.id}/gerenciar?erro=email-nao-enviado`);
    const [convidado] = await db
      .select()
      .from(players)
      .where(eq(players.name, "Convidado Sem Email Entregue"));
    expect(convidado).toBeDefined();
    expect((await linhaDe(pelada, convidado))?.status).toBe("waitlist");
    const [convite] = await db.select().from(invites).where(eq(invites.playerId, convidado.id));
    expect(convite).toMatchObject({ email: "convidado@example.com", emailSentAt: null });
  });
});

describe("incluirNoJogo", () => {
  it("quem estava como falta e é escalado volta a estar dentro", async () => {
    const { pelada } = await peladaComAdminLogado({ status: "teams_drawn" });
    const faltoso = await criarJogador();
    await confirmarPresenca(pelada, faltoso, { status: "no_show", minutosAtras: 10 });

    const [timeA] = await db
      .insert(teams)
      .values({ matchDayId: pelada.id, name: "Preto", sortOrder: 0 })
      .returning();
    const [timeB] = await db
      .insert(teams)
      .values({ matchDayId: pelada.id, name: "Branco", sortOrder: 1 })
      .returning();
    const [jogo] = await db
      .insert(games)
      .values({ matchDayId: pelada.id, teamAId: timeA.id, teamBId: timeB.id })
      .returning();

    await incluirNoJogo(pelada.id, jogo.id, "A", faltoso.id);

    const [escalado] = await db
      .select()
      .from(gamePlayers)
      .where(and(eq(gamePlayers.gameId, jogo.id), eq(gamePlayers.playerId, faltoso.id)));
    expect(escalado?.side).toBe("A");
    expect((await linhaDe(pelada, faltoso))?.status).toBe("in");
  });
});
