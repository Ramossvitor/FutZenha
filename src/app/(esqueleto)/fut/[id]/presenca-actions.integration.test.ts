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
  goals,
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
import { setMyAttendance } from "@/app/(esqueleto)/fut/[id]/actions";
import {
  convidarParaFut,
  definirPresenca,
  drawTeamsAction,
  marcarFalta,
  promoverDaEspera,
  updateMatchDay,
} from "@/app/(esqueleto)/fut/[id]/gerenciar/actions";
import { incluirNoJogo, moverLado } from "@/app/(esqueleto)/fut/[id]/gerenciar/encerrar/actions";
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
    const groupId = (await criarGrupo()).id;
    const fut = await criarFut({ groupId });
    const { jogador, conta } = await criarJogadorComConta();
    await logarComo(conta);

    await setMyAttendance(fut.id, "in");

    expect(await linhaDe(fut, jogador)).toBeNull();
  });

  it("fut de grupo: membro entra na lista", async () => {
    const groupId = (await criarGrupo()).id;
    const fut = await criarFut({ groupId });
    const { jogador, conta } = await criarJogadorComConta();
    await entrarNoGrupo(groupId, jogador);
    await logarComo(conta);

    await setMyAttendance(fut.id, "in");

    expect((await linhaDe(fut, jogador))?.status).toBe("in");
  });

  // A outra metade do consentimento: assim como quem organiza não põe estranho
  // na lista, estranho não se põe sozinho. Em fut avulso a entrada de quem
  // nunca esteve ali é por pedido, convite ou link (ver src/lib/fut-entrada.ts).
  it("fut avulso NÃO aceita quem nunca esteve na lista — tem que pedir", async () => {
    // Com organizador: fut órfão não tem lista de ninguém a proteger, e por
    // isso continua aberto a todos (ver estaNoCirculoDoFut).
    const dono = await criarJogadorComConta();
    const fut = await criarFut({ createdByPlayerId: dono.jogador.id });
    const { jogador, conta } = await criarJogadorComConta();
    await logarComo(conta);

    const url = await esperaRedirect(() => setMyAttendance(fut.id, "in"));

    expect(url).toBe(`/fut/${fut.id}?erro=precisa-pedir-entrada`);
    expect(await linhaDe(fut, jogador)).toBeNull();
  });

  // Quem JÁ tem linha na lista segue no vaivém normal: sair e voltar é o caso
  // de todo dia, e o consentimento já foi dado quando a pessoa entrou.
  it("fut avulso: quem já esteve na lista volta sozinho", async () => {
    const dono = await criarJogadorComConta();
    const fut = await criarFut({ createdByPlayerId: dono.jogador.id });
    const { jogador, conta } = await criarJogadorComConta();
    await confirmarPresenca(fut, jogador, { status: "out" });
    await logarComo(conta);

    await setMyAttendance(fut.id, "in");

    expect((await linhaDe(fut, jogador))?.status).toBe("in");
  });

  it("ex-membro que já está no fut segue elegível", async () => {
    const groupId = (await criarGrupo()).id;
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

  // A exceção da lista fechada vale em fut DE GRUPO, onde "elegível" quer dizer
  // membro — e entrar no grupo foi o consentimento.
  it("lista fechada em fut de grupo: membro entra e é avisado no mesmo commit", async () => {
    const groupId = (await criarGrupo()).id;
    const { fut } = await futComAdminLogado({ groupId, status: "teams_drawn" });
    const alvo = await criarJogadorComConta();
    await entrarNoGrupo(groupId, alvo.jogador);

    await definirPresenca(fut.id, alvo.jogador.id, "in");

    expect((await linhaDe(fut, alvo.jogador))?.status).toBe("in");
    const avisos = await notificacoesDe(alvo.jogador);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({
      type: "pelada_presenca_definida",
      dedupeKey: `presenca:${fut.id}:${alvo.jogador.id}`,
    });
  });

  // E NÃO vale em fut avulso. Ali "elegível" é a plataforma inteira (o
  // `undefined` de condicaoElegivel), então a exceção transformava qualquer
  // pessoa logada — basta criar um fut e sortear — em alguém que marca presença
  // de estranhos. Cada marcação dispara notificação, push e um e-mail de
  // calendário com texto livre dela para a caixa da vítima.
  it("lista fechada em fut AVULSO: estranho com conta não é marcado", async () => {
    const { fut } = await futComAdminLogado({ status: "teams_drawn" });
    const alvo = await criarJogadorComConta();

    const url = await esperaRedirect(definirPresenca(fut.id, alvo.jogador.id, "in"));

    expect(url).toBe(`/fut/${fut.id}/gerenciar?erro=precisa-confirmar`);
    expect(await linhaDe(fut, alvo.jogador)).toBeNull();
    expect(await notificacoesDe(alvo.jogador)).toHaveLength(0);
  });

  // O caso que a exceção existe para servir continua de pé: o convidado que
  // chegou na hora não tem conta e não consegue se marcar sozinho.
  it("lista fechada em fut avulso: quem não tem conta segue livre", async () => {
    const { fut } = await futComAdminLogado({ status: "teams_drawn" });
    const semConta = await criarJogador();

    await definirPresenca(fut.id, semConta.id, "in");

    expect((await linhaDe(fut, semConta))?.status).toBe("in");
  });

  it("lista fechada: inelegível é recusado", async () => {
    const groupId = (await criarGrupo()).id;
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

describe("moverLado", () => {
  // Correção depois do jogo: a escalação estava errada, e o `side` que o
  // lançamento copiou dela também. Os dois viram juntos — senão o chip do gol
  // (que lê o `side` gravado antes da escalação) não mostraria o conserto. O
  // gol sem lado gravado é de antes da súmula e continua derivado da escalação.
  it("vira a escalação e os gols com lado gravado; o gol sem lado fica nulo", async () => {
    const { fut } = await futComAdminLogado({ status: "teams_drawn" });
    const jogador = await criarJogador();
    await confirmarPresenca(fut, jogador, { status: "in", minutosAtras: 10 });

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
    await db.insert(gamePlayers).values({ gameId: jogo.id, playerId: jogador.id, side: "A" });
    await db.insert(goals).values([
      { gameId: jogo.id, playerId: jogador.id, quantity: 1, side: "A" },
      { gameId: jogo.id, playerId: jogador.id, quantity: 1, side: null },
    ]);

    await moverLado(fut.id, jogo.id, jogador.id);

    const [escalado] = await db
      .select({ side: gamePlayers.side })
      .from(gamePlayers)
      .where(and(eq(gamePlayers.gameId, jogo.id), eq(gamePlayers.playerId, jogador.id)));
    expect(escalado?.side).toBe("B");

    const gols = await db
      .select({ side: goals.side })
      .from(goals)
      .where(and(eq(goals.gameId, jogo.id), eq(goals.playerId, jogador.id)))
      .orderBy(goals.id);
    expect(gols.map((g) => g.side)).toEqual(["B", null]);
  });
});

// O ciclo completo do consentimento retirado: o organizador põe, a pessoa tira o
// nome, e a partir daí ninguém a repõe. É o contrapeso da exceção da lista
// fechada — sem ele, o aviso de "marcaram sua presença" não servia de nada,
// porque a única reação possível podia ser desfeita pelo mesmo organizador.
describe("retirar o nome da lista", () => {
  /**
   * Fut de grupo já sorteado, com o alvo posto na lista pelo organizador — a
   * situação exata que a exceção da lista fechada permite. Devolve as duas
   * contas porque os testes trocam de sessão no meio.
   */
  async function postoNaLista() {
    const groupId = (await criarGrupo()).id;
    const organizador = await criarJogadorComConta();
    await logarComo(organizador.conta);
    const fut = await criarFut({
      groupId,
      status: "teams_drawn",
      createdByPlayerId: organizador.jogador.id,
    });
    const alvo = await criarJogadorComConta();
    await entrarNoGrupo(groupId, alvo.jogador);
    await definirPresenca(fut.id, alvo.jogador.id, "in");
    expect((await linhaDe(fut, alvo.jogador))?.status).toBe("in");
    return { fut, organizador, alvo };
  }

  // Sem isto a promessa do aviso é vazia: é DEPOIS do sorteio que o organizador
  // pode incluir quem quiser, e era exatamente aí que o botão "Fora" sumia.
  it("a pessoa sai mesmo com a lista fechada — é aí que ela mais precisa", async () => {
    const { fut, alvo } = await postoNaLista();
    await logarComo(alvo.conta);

    await setMyAttendance(fut.id, "out");

    expect((await linhaDe(fut, alvo.jogador))?.status).toBe("out");
  });

  it("depois de sair, o organizador não repõe", async () => {
    const { fut, organizador, alvo } = await postoNaLista();
    await logarComo(alvo.conta);
    await setMyAttendance(fut.id, "out");
    await logarComo(organizador.conta);

    const url = await esperaRedirect(definirPresenca(fut.id, alvo.jogador.id, "in"));

    expect(url).toBe(`/fut/${fut.id}/gerenciar?erro=recusou`);
    expect((await linhaDe(fut, alvo.jogador))?.status).toBe("out");
  });

  // A recusa vale contra todo mundo, e o admin da plataforma é o teste que
  // importa: ele atravessa todas as outras regras de fut, e esta não.
  it("nem o admin da plataforma repõe", async () => {
    const { fut, alvo } = await postoNaLista();
    await logarComo(alvo.conta);
    await setMyAttendance(fut.id, "out");

    const chefe = await criarJogadorComConta({}, { isPlatformAdmin: true });
    await logarComo(chefe.conta);

    const url = await esperaRedirect(definirPresenca(fut.id, alvo.jogador.id, "in"));

    expect(url).toBe(`/fut/${fut.id}/gerenciar?erro=recusou`);
    expect((await linhaDe(fut, alvo.jogador))?.status).toBe("out");
  });

  // O desfazer, e o único caminho de volta que existe — sem ele, quem recusou
  // ficaria trancado fora de um fut em que pode estar fisicamente.
  it("a própria pessoa volta quando quer, mesmo com a lista fechada", async () => {
    const { fut, alvo } = await postoNaLista();
    await logarComo(alvo.conta);
    await setMyAttendance(fut.id, "out");

    await setMyAttendance(fut.id, "in");

    expect((await linhaDe(fut, alvo.jogador))?.status).toBe("in");
  });

  // E voltando ela destrava o organizador de novo: a recusa é um estado, não uma
  // punição permanente.
  it("voltando, o organizador volta a mandar na presença dela", async () => {
    const { fut, organizador, alvo } = await postoNaLista();
    await logarComo(alvo.conta);
    await setMyAttendance(fut.id, "out");
    await setMyAttendance(fut.id, "in");
    await logarComo(organizador.conta);

    await definirPresenca(fut.id, alvo.jogador.id, "out");

    expect((await linhaDe(fut, alvo.jogador))?.status).toBe("out");
  });
});
