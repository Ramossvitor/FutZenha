// Exclusão de fut por votação, de ponta a ponta: abertura pela action do
// admin, votos até o quórum, cascades da aprovação (com replay de nota no mesmo
// commit), prazo vencido sem quórum e a autorização do eleitorado.

import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { abrirVotacaoExclusao } from "@/app/fut/[id]/gerenciar/actions";
import { votar } from "@/app/votacao/[id]/actions";
import { db } from "@/db";
import {
  attendances,
  gamePlayers,
  games,
  goals,
  matchDayDeletionVoters,
  matchDayDeletionVotes,
  matchDays,
  notifications,
  players,
  ratingRounds,
  ratings,
  skillHistory,
  teams,
  type MatchDay,
} from "@/db/schema";
import { abrirVotacao, registrarVoto, resolverVotacoesVencidas } from "@/lib/deletion";
import {
  confirmarPresenca,
  criarJogador,
  criarJogadorComConta,
  criarFut,
  logarComo,
} from "@/test/fixtures";
import { esperaRedirect } from "@/test/navigation-fake";

const MOTIVO = "Placar lançado errado e sem janela de correção";

type Logavel = Awaited<ReturnType<typeof criarJogadorComConta>>;

/**
 * Fut encerrado em que três contas ativas jogaram (o eleitorado) e um quarto
 * jogador sem conta entrou em campo — afetado, mas fora do eleitorado.
 */
async function montarFutEncerrado() {
  const admin = await criarJogadorComConta();
  const beto = await criarJogadorComConta();
  const caio = await criarJogadorComConta();
  const semConta = await criarJogador();

  const fut = await criarFut({ status: "finished", createdByPlayerId: admin.jogador.id });

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
    .values({ matchDayId: fut.id, teamAId: timeA.id, teamBId: timeB.id, scoreA: 2, scoreB: 1 })
    .returning();
  await db.insert(gamePlayers).values([
    { gameId: jogo.id, playerId: admin.jogador.id, side: "A" },
    { gameId: jogo.id, playerId: beto.jogador.id, side: "A" },
    { gameId: jogo.id, playerId: caio.jogador.id, side: "B" },
    { gameId: jogo.id, playerId: semConta.id, side: "B" },
  ]);
  await db.insert(goals).values({ gameId: jogo.id, playerId: beto.jogador.id, quantity: 2 });

  await confirmarPresenca(fut, admin.jogador, { minutosAtras: 40 });
  await confirmarPresenca(fut, beto.jogador, { minutosAtras: 30 });
  await confirmarPresenca(fut, caio.jogador, { minutosAtras: 20 });
  await confirmarPresenca(fut, semConta, { minutosAtras: 10 });

  return { fut, admin, beto, caio, semConta };
}

/**
 * Rodada já apurada com uma nota fora do 5,0 — é ela que denuncia se o replay
 * rodou junto com o delete. 5★ de média 10,0: nova = (2×5 + 10) / 3 = 6,7.
 */
async function apurarRodadaComNota(fut: MatchDay, avaliador: Logavel, avaliado: Logavel) {
  const [rodada] = await db
    .insert(ratingRounds)
    .values({
      matchDayId: fut.id,
      status: "closed",
      deadlineAt: sql`now() - interval '2 days'`,
      closedAt: sql`now() - interval '1 day'`,
      closeReason: "todos_avaliaram",
    })
    .returning();
  await db.insert(ratings).values({
    roundId: rodada.id,
    raterPlayerId: avaliador.jogador.id,
    ratedPlayerId: avaliado.jogador.id,
    stars: 5,
  });
  await db.insert(skillHistory).values({
    playerId: avaliado.jogador.id,
    roundId: rodada.id,
    skillBefore: 5,
    skillAfter: 6.7,
    ratingsCount: 1,
    averageReceived: 10,
  });
  await db.update(players).set({ skill: 6.7 }).where(eq(players.id, avaliado.jogador.id));
}

async function abrirVotacaoDe(fut: MatchDay, proponente: Logavel): Promise<number> {
  const abertura = await abrirVotacao(fut.id, MOTIVO, proponente.jogador.id);
  if (abertura.tipo !== "votacao") throw new Error(`abertura inesperada: ${abertura.tipo}`);
  return abertura.voteId;
}

async function getVotacaoNoBanco(voteId: number) {
  const [votacao] = await db
    .select()
    .from(matchDayDeletionVotes)
    .where(eq(matchDayDeletionVotes.id, voteId));
  return votacao;
}

describe("exclusão de fut por votação", () => {
  it("aprovada no quórum: apaga o fut com os filhos e recalcula as notas", async () => {
    const { fut, admin, beto, caio } = await montarFutEncerrado();
    await apurarRodadaComNota(fut, admin, beto);

    await logarComo(admin.conta);
    const form = new FormData();
    form.set("reason", MOTIVO);
    expect(await esperaRedirect(abrirVotacaoExclusao(fut.id, form))).toBe(
      `/fut/${fut.id}/gerenciar`,
    );

    const [votacao] = await db.select().from(matchDayDeletionVotes);
    expect(votacao.matchDayId).toBe(fut.id);
    // quem jogou sem conta é afetado, mas não entra no eleitorado congelado
    expect(votacao.eligibleCount).toBe(3);
    expect(votacao.requiredYes).toBe(3); // ceil(0,85 × 3)

    const eleitores = await db.select().from(matchDayDeletionVoters);
    expect(eleitores.map((e) => e.playerId).sort((a, b) => a - b)).toEqual(
      [admin.jogador.id, beto.jogador.id, caio.jogador.id].sort((a, b) => a - b),
    );

    expect(await votar(votacao.id, true)).toEqual({ success: true });
    await logarComo(beto.conta);
    expect(await votar(votacao.id, true)).toEqual({ success: true });

    // 2 de 3 ainda não decide: votação aberta e fut de pé
    expect((await getVotacaoNoBanco(votacao.id)).status).toBe("open");
    expect(await db.select().from(matchDays)).toHaveLength(1);

    await logarComo(caio.conta);
    expect(await votar(votacao.id, true)).toEqual({ success: true });

    expect(await db.select().from(matchDays)).toHaveLength(0);
    expect(await db.select().from(attendances)).toHaveLength(0);
    expect(await db.select().from(teams)).toHaveLength(0);
    expect(await db.select().from(games)).toHaveLength(0);
    expect(await db.select().from(gamePlayers)).toHaveLength(0);
    expect(await db.select().from(goals)).toHaveLength(0);
    expect(await db.select().from(ratingRounds)).toHaveLength(0);
    expect(await db.select().from(ratings)).toHaveLength(0);
    expect(await db.select().from(skillHistory)).toHaveLength(0);
    // a própria votação vai junto, pelo cascade do match_day_id
    expect(await db.select().from(matchDayDeletionVotes)).toHaveLength(0);
    expect(await db.select().from(matchDayDeletionVoters)).toHaveLength(0);

    // o replay rodou no mesmo commit: a nota que veio da rodada apagada volta a 5,0
    const [betoDepois] = await db.select().from(players).where(eq(players.id, beto.jogador.id));
    expect(betoDepois.skill).toBe(5);

    const desfechos = await db
      .select()
      .from(notifications)
      .where(eq(notifications.type, "deletion_vote_resolved"));
    expect(desfechos).toHaveLength(3);
    for (const aviso of desfechos) expect(aviso.title).toBe("Fut excluído pelo grupo");
  });

  it("voto repetido devolve ja-votou e não conta duas vezes", async () => {
    const { fut, admin, beto } = await montarFutEncerrado();
    const voteId = await abrirVotacaoDe(fut, admin);

    expect(await registrarVoto(voteId, beto.jogador.id, true)).toBe("registrado");
    // definitivo: repetir não regrava nem inverte o voto
    expect(await registrarVoto(voteId, beto.jogador.id, false)).toBe("ja-votou");

    const [meuVoto] = await db
      .select()
      .from(matchDayDeletionVoters)
      .where(
        and(
          eq(matchDayDeletionVoters.voteId, voteId),
          eq(matchDayDeletionVoters.playerId, beto.jogador.id),
        ),
      );
    expect(meuVoto.inFavor).toBe(true);

    const aFavor = await db
      .select()
      .from(matchDayDeletionVoters)
      .where(
        and(eq(matchDayDeletionVoters.voteId, voteId), eq(matchDayDeletionVoters.inFavor, true)),
      );
    expect(aFavor).toHaveLength(1);

    await logarComo(beto.conta);
    expect(await votar(voteId, true)).toEqual({
      error: "Você já votou nesta votação, e o voto é definitivo.",
    });
  });

  it("vencida sem quórum: voto atrasado não conta e o varredor rejeita sem apagar", async () => {
    const { fut, admin, beto } = await montarFutEncerrado();
    const voteId = await abrirVotacaoDe(fut, admin);
    expect(await registrarVoto(voteId, admin.jogador.id, true)).toBe("registrado");

    await db
      .update(matchDayDeletionVotes)
      .set({ deadlineAt: sql`now() - interval '1 hour'` })
      .where(eq(matchDayDeletionVotes.id, voteId));

    // vencida mas ainda `open` no banco: um SIM atrasado não entra na conta
    expect(await registrarVoto(voteId, beto.jogador.id, true)).toBe("encerrada");

    expect(await resolverVotacoesVencidas(db)).toBe(1);

    const votacao = await getVotacaoNoBanco(voteId);
    expect(votacao.status).toBe("rejected");
    expect(votacao.resolvedAt).not.toBeNull();
    expect(await db.select().from(matchDays)).toHaveLength(1);

    // já resolvida: a segunda varredura não encontra nada
    expect(await resolverVotacoesVencidas(db)).toBe(0);

    const desfechos = await db
      .select()
      .from(notifications)
      .where(eq(notifications.type, "deletion_vote_resolved"));
    expect(desfechos).toHaveLength(3);
    for (const aviso of desfechos) expect(aviso.title).toBe("Fut mantido");
  });

  it("quem não é do eleitorado não vota", async () => {
    const { fut, admin } = await montarFutEncerrado();
    const deFora = await criarJogadorComConta();
    const voteId = await abrirVotacaoDe(fut, admin);

    expect(await registrarVoto(voteId, deFora.jogador.id, true)).toBe("nao-elegivel");

    await logarComo(deFora.conta);
    expect(await votar(voteId, true)).toEqual({
      error: "Você não jogou este fut, então não vota nele.",
    });

    const linhas = await db
      .select()
      .from(matchDayDeletionVoters)
      .where(eq(matchDayDeletionVoters.playerId, deFora.jogador.id));
    expect(linhas).toHaveLength(0);
  });

  it("uma votação por fut: reabrir devolve ja-existe", async () => {
    const { fut, admin, beto } = await montarFutEncerrado();
    await abrirVotacaoDe(fut, admin);

    expect(await abrirVotacao(fut.id, MOTIVO, beto.jogador.id)).toEqual({ tipo: "ja-existe" });
    expect(await db.select().from(matchDayDeletionVotes)).toHaveLength(1);
  });

  it("rejeita na hora quando nem todos os pendentes votando SIM fechariam o quórum", async () => {
    const { fut, admin, beto, caio } = await montarFutEncerrado();
    const voteId = await abrirVotacaoDe(fut, admin);

    // 3 eleitores exigem 3 SIM: um único NÃO já torna o quórum impossível
    expect(await registrarVoto(voteId, beto.jogador.id, false)).toBe("registrado");

    const votacao = await getVotacaoNoBanco(voteId);
    expect(votacao.status).toBe("rejected");
    expect(await db.select().from(matchDays)).toHaveLength(1);

    // encerrada, os demais nem votam mais
    expect(await registrarVoto(voteId, caio.jogador.id, true)).toBe("encerrada");
  });
});
