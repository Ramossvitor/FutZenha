"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  attendances,
  gamePlayers,
  games,
  goals,
  matchDays,
  players,
  teamPlayers,
  teams,
  type MatchDay,
} from "@/db/schema";
import { criarJogadorComConvite, parseEmailDeConvite } from "@/lib/convites";
import { isUniqueViolation } from "@/lib/db-errors";
import { abrirVotacao, apagarPelada, motivoExclusaoSchema } from "@/lib/deletion";
import { drawTeams } from "@/lib/draw";
import { parseMatchDayForm } from "@/lib/match-day-form";
import { podeMarcarPor } from "@/lib/presenca";
import { requirePeladaAdmin } from "@/lib/require-pelada-admin";
import { defaultTeamNames } from "@/lib/team-colors";

export async function updateMatchDay(matchDayId: number, formData: FormData) {
  await requirePeladaAdmin(matchDayId);
  const parsed = parseMatchDayForm(formData);
  if (!parsed.success) redirect(`/pelada/${matchDayId}/gerenciar?erro=dados-invalidos`);

  await db.update(matchDays).set(parsed.data).where(eq(matchDays.id, matchDayId));
  revalidatePath("/");
  revalidatePath(`/pelada/${matchDayId}/gerenciar`);
  revalidatePath(`/pelada/${matchDayId}`);
}

/**
 * Apaga a pelada. Só vale para pelada não encerrada — nela não há gol, V/E/D
 * nem avaliação de ninguém em jogo. Encerrada, quem decide é quem jogou, pela
 * votação (ver abrirVotacaoExclusao).
 */
export async function deleteMatchDay(matchDayId: number) {
  const { matchDay } = await requirePeladaAdmin(matchDayId);
  if (matchDay.status === "finished") {
    redirect(`/pelada/${matchDayId}/gerenciar?erro=precisa-votacao`);
  }

  await db.delete(matchDays).where(eq(matchDays.id, matchDayId));
  revalidatePath("/");
  revalidatePath("/peladas");
  redirect("/peladas");
}

/**
 * Abre a votação para apagar uma pelada encerrada. Sem ninguém com conta que
 * tenha jogado, não há quem seja afetado — aí o admin apaga direto.
 */
export async function abrirVotacaoExclusao(matchDayId: number, formData: FormData) {
  const { session, matchDay } = await requirePeladaAdmin(matchDayId);
  const parsed = motivoExclusaoSchema.safeParse(formData.get("reason") ?? "");
  if (!parsed.success) redirect(`/pelada/${matchDayId}/gerenciar?erro=motivo-curto`);

  if (matchDay.status !== "finished") {
    redirect(`/pelada/${matchDayId}/gerenciar?erro=dados-invalidos`);
  }

  const resultado = await abrirVotacao(matchDayId, parsed.data, session.player.id);
  if (resultado.tipo === "sem-eleitores") {
    // Mesmo sem eleitor, a pelada pode ter rodada apurada e avaliações válidas
    // — basta as contas de quem jogou terem sido desativadas depois. O delete
    // leva as avaliações por cascade, então o replay tem que rodar no mesmo
    // commit, como em resolverVotacao(). Sem ele a nota de todo mundo ficaria
    // com a contribuição de uma pelada que não existe mais.
    await db.transaction((tx) => apagarPelada(tx, matchDayId, `nota:pelada-apagada:${matchDayId}`));
    revalidatePath("/");
    revalidatePath("/peladas");
    revalidatePath("/rankings");
    redirect("/peladas?ok=excluida-sem-votacao");
  }

  revalidateMatchDay(matchDayId);
  redirect(`/pelada/${matchDayId}/gerenciar`);
}

// A escalação (times, jogos, quem jogou) é imutável depois do encerramento —
// é ela que define quem avalia quem, e mexer nela invalidaria avaliações já
// enviadas. Corrigir escalação errada só excluindo a pelada.
function assertEscalacaoEditavel(matchDay: MatchDay) {
  if (matchDay.status === "finished") {
    redirect(`/pelada/${matchDay.id}/gerenciar?erro=escalacao-travada`);
  }
}

// Placar e gols não mexem em quem avalia quem, então ganham uma janela de 24h
// depois do encerramento. `finished_at` nulo numa pelada encerrada conta como
// fora da janela: sem marco temporal não há o que liberar.
const JANELA_CORRECAO = sql`
  ${matchDays.status} <> 'finished'
  or (${matchDays.finishedAt} is not null and ${matchDays.finishedAt} + interval '24 hours' > now())
`;

async function assertPlacarEditavel(matchDayId: number) {
  const [row] = await db
    .select({ dentroDaJanela: sql<boolean>`${JANELA_CORRECAO}` })
    .from(matchDays)
    .where(eq(matchDays.id, matchDayId));
  // O requirePeladaAdmin viu a pelada existir, mas ela pode ter sido apagada
  // entre o guard e esta query (votação aprovada, admin da plataforma) — sem o
  // `!row`, isso virava TypeError em vez de mensagem.
  if (!row || !row.dentroDaJanela) {
    redirect(`/pelada/${matchDayId}/gerenciar?erro=janela-encerrada`);
  }
}

function revalidateMatchDay(matchDayId: number) {
  revalidatePath("/");
  revalidatePath("/peladas");
  revalidatePath(`/pelada/${matchDayId}/gerenciar`);
  revalidatePath(`/pelada/${matchDayId}`);
}

export async function drawTeamsAction(matchDayId: number, formData: FormData) {
  const { matchDay } = await requirePeladaAdmin(matchDayId);
  const teamCount = Number(formData.get("teamCount"));
  if (!Number.isInteger(teamCount) || teamCount < 2 || teamCount > 6) {
    redirect(`/pelada/${matchDayId}/gerenciar?erro=dados-invalidos`);
  }

  assertEscalacaoEditavel(matchDay);

  // Re-sortear apagaria os jogos por cascade — exige apagar os jogos antes.
  const existingGames = await db.select().from(games).where(eq(games.matchDayId, matchDayId));
  if (existingGames.length > 0) {
    redirect(`/pelada/${matchDayId}/gerenciar?erro=jogos-lancados`);
  }

  const confirmed = await db
    .select({
      id: players.id,
      name: players.name,
      skill: players.skill,
      isGoalkeeper: players.isGoalkeeper,
    })
    .from(attendances)
    .innerJoin(players, eq(attendances.playerId, players.id))
    .where(and(eq(attendances.matchDayId, matchDayId), eq(attendances.status, "in")));

  if (confirmed.length < teamCount) {
    redirect(`/pelada/${matchDayId}/gerenciar?erro=poucos-jogadores`);
  }

  const drawn = drawTeams(confirmed, teamCount);

  await db.transaction(async (tx) => {
    await tx.delete(teams).where(eq(teams.matchDayId, matchDayId));
    for (const [i, team] of drawn.entries()) {
      const [created] = await tx
        .insert(teams)
        .values({ matchDayId, name: defaultTeamNames[i] ?? `Time ${i + 1}`, sortOrder: i })
        .returning();
      await tx
        .insert(teamPlayers)
        .values(team.players.map((p) => ({ teamId: created.id, playerId: p.id })));
    }
    await tx.update(matchDays).set({ status: "teams_drawn" }).where(eq(matchDays.id, matchDayId));
  });

  revalidateMatchDay(matchDayId);
  redirect(`/pelada/${matchDayId}/gerenciar`);
}

export async function swapPlayersAction(matchDayId: number, formData: FormData) {
  const { matchDay } = await requirePeladaAdmin(matchDayId);
  assertEscalacaoEditavel(matchDay);
  const playerA = Number(formData.get("playerA"));
  const playerB = Number(formData.get("playerB"));
  if (!Number.isInteger(playerA) || !Number.isInteger(playerB) || playerA === playerB) return;

  const dayTeams = await db.select().from(teams).where(eq(teams.matchDayId, matchDayId));
  const teamIds = dayTeams.map((t) => t.id);
  if (teamIds.length === 0) return;

  const rows = await db
    .select()
    .from(teamPlayers)
    .where(and(inArray(teamPlayers.teamId, teamIds), inArray(teamPlayers.playerId, [playerA, playerB])));
  const rowA = rows.find((r) => r.playerId === playerA);
  const rowB = rows.find((r) => r.playerId === playerB);
  if (!rowA || !rowB || rowA.teamId === rowB.teamId) return;

  await db.transaction(async (tx) => {
    await tx
      .update(teamPlayers)
      .set({ teamId: rowB.teamId })
      .where(and(eq(teamPlayers.teamId, rowA.teamId), eq(teamPlayers.playerId, playerA)));
    await tx
      .update(teamPlayers)
      .set({ teamId: rowA.teamId })
      .where(and(eq(teamPlayers.teamId, rowB.teamId), eq(teamPlayers.playerId, playerB)));
  });

  revalidateMatchDay(matchDayId);
}

export async function createGame(matchDayId: number, formData: FormData) {
  const { matchDay } = await requirePeladaAdmin(matchDayId);
  assertEscalacaoEditavel(matchDay);
  const teamAId = Number(formData.get("teamAId"));
  const teamBId = Number(formData.get("teamBId"));
  const scoreA = Number(formData.get("scoreA"));
  const scoreB = Number(formData.get("scoreB"));
  if (
    !Number.isInteger(teamAId) ||
    !Number.isInteger(teamBId) ||
    teamAId === teamBId ||
    !Number.isInteger(scoreA) ||
    !Number.isInteger(scoreB) ||
    scoreA < 0 ||
    scoreB < 0
  ) {
    redirect(`/pelada/${matchDayId}/gerenciar?erro=dados-invalidos`);
  }

  const dayTeams = await db.select().from(teams).where(eq(teams.matchDayId, matchDayId));
  const teamIds = new Set(dayTeams.map((t) => t.id));
  if (!teamIds.has(teamAId) || !teamIds.has(teamBId)) {
    redirect(`/pelada/${matchDayId}/gerenciar?erro=dados-invalidos`);
  }

  const existing = await db.select().from(games).where(eq(games.matchDayId, matchDayId));

  // A escalação do jogo é um snapshot dos times da pelada tirado agora. Depois
  // disso ela é editável por jogo e independente do colete.
  const lineup = await db
    .select({ playerId: teamPlayers.playerId, teamId: teamPlayers.teamId })
    .from(teamPlayers)
    .where(inArray(teamPlayers.teamId, [teamAId, teamBId]));

  await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(games)
      .values({ matchDayId, teamAId, teamBId, scoreA, scoreB, sortOrder: existing.length })
      .returning();
    if (lineup.length > 0) {
      await tx.insert(gamePlayers).values(
        lineup.map((row) => ({
          gameId: created.id,
          playerId: row.playerId,
          side: row.teamId === teamAId ? ("A" as const) : ("B" as const),
        })),
      );
    }
  });
  revalidateMatchDay(matchDayId);
}

export async function updateGameScore(matchDayId: number, gameId: number, formData: FormData) {
  await requirePeladaAdmin(matchDayId);
  await assertPlacarEditavel(matchDayId);
  const scoreA = Number(formData.get("scoreA"));
  const scoreB = Number(formData.get("scoreB"));
  if (!Number.isInteger(scoreA) || !Number.isInteger(scoreB) || scoreA < 0 || scoreB < 0) {
    redirect(`/pelada/${matchDayId}/gerenciar?erro=dados-invalidos`);
  }
  await db
    .update(games)
    .set({ scoreA, scoreB })
    .where(and(eq(games.id, gameId), eq(games.matchDayId, matchDayId)));
  revalidateMatchDay(matchDayId);
}

export async function deleteGame(matchDayId: number, gameId: number) {
  const { matchDay } = await requirePeladaAdmin(matchDayId);
  assertEscalacaoEditavel(matchDay);
  await db.delete(games).where(and(eq(games.id, gameId), eq(games.matchDayId, matchDayId)));
  revalidateMatchDay(matchDayId);
}

export async function addGoal(matchDayId: number, gameId: number, formData: FormData) {
  await requirePeladaAdmin(matchDayId);
  await assertPlacarEditavel(matchDayId);
  const playerId = Number(formData.get("playerId"));
  const quantity = Number(formData.get("quantity") ?? 1);
  if (!Number.isInteger(playerId) || !Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
    redirect(`/pelada/${matchDayId}/gerenciar?erro=dados-invalidos`);
  }
  const [game] = await db
    .select()
    .from(games)
    .where(and(eq(games.id, gameId), eq(games.matchDayId, matchDayId)));
  if (!game) redirect(`/pelada/${matchDayId}/gerenciar?erro=dados-invalidos`);

  // Escopo pelo jogo, na mesma linha do que deleteGoal faz com o goalId:
  // `playerId` vem do cliente, e sem isto daria para pendurar gol em quem nem
  // entrou em campo — a artilharia (src/lib/stats.ts) conta toda linha de gol
  // de pelada encerrada, então seria placar inventado no ranking de alguém.
  const [escalado] = await db
    .select({ playerId: gamePlayers.playerId })
    .from(gamePlayers)
    .where(and(eq(gamePlayers.gameId, gameId), eq(gamePlayers.playerId, playerId)));
  if (!escalado) redirect(`/pelada/${matchDayId}/gerenciar?erro=artilheiro-fora-do-jogo`);

  await db.insert(goals).values({ gameId, playerId, quantity });
  revalidateMatchDay(matchDayId);
}

export async function deleteGoal(matchDayId: number, goalId: number) {
  await requirePeladaAdmin(matchDayId);
  await assertPlacarEditavel(matchDayId);
  // Escopo pela pelada: `goalId` vem do cliente, e sem o filtro um id de outra
  // pelada — encerrada há meses — seria apagado por esta mesma chamada.
  await db.delete(goals).where(
    and(
      eq(goals.id, goalId),
      inArray(
        goals.gameId,
        db.select({ id: games.id }).from(games).where(eq(games.matchDayId, matchDayId)),
      ),
    ),
  );
  revalidateMatchDay(matchDayId);
}

// Encerrar mora em ./[id]/encerrar/actions.ts: passa pela conferência da
// escalação, que é o que trava a base da avaliação. Não existe "reabrir" —
// escalação errada só se conserta excluindo a pelada.

const convidadoSchema = z.object({
  name: z.string().trim().min(1, "Nome é obrigatório").max(60),
  isGoalkeeper: z.coerce.boolean(),
});

/**
 * Cadastra alguém novo e já marca a presença dele nesta pelada.
 *
 * É o que torna o admin de pelada autônomo: apareceu gente nova na quadra, ele
 * resolve sem depender da plataforma. Só cria jogador **novo** — e jogador novo
 * nunca tem conta, então nunca é reset de senha disfarçado. O convite sai junto
 * e o link aparece na própria tela de gestão, para o organizador entregar na
 * mão, como sempre.
 */
export async function convidarParaPelada(matchDayId: number, formData: FormData) {
  const { matchDay } = await requirePeladaAdmin(matchDayId);
  assertEscalacaoEditavel(matchDay);

  const parsed = convidadoSchema.safeParse({
    name: formData.get("name") ?? "",
    isGoalkeeper: formData.get("isGoalkeeper") === "on",
  });
  if (!parsed.success) redirect(`/pelada/${matchDayId}/gerenciar?erro=dados-invalidos`);
  const email = parseEmailDeConvite(formData.get("email"));
  if (!email.success) redirect(`/pelada/${matchDayId}/gerenciar?erro=email-invalido`);

  try {
    await db.transaction(async (tx) => {
      const { playerId } = await criarJogadorComConvite(tx, {
        name: parsed.data.name,
        nickname: null,
        isGoalkeeper: parsed.data.isGoalkeeper,
        email: email.data,
      });
      await tx.insert(attendances).values({ matchDayId, playerId, status: "in" });
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      redirect(`/pelada/${matchDayId}/gerenciar?erro=nome-duplicado`);
    }
    throw error;
  }

  revalidateMatchDay(matchDayId);
}

export async function definirPresenca(
  matchDayId: number,
  playerId: number,
  status: "in" | "out",
) {
  const { session, matchDay } = await requirePeladaAdmin(matchDayId);
  assertEscalacaoEditavel(matchDay);
  // `playerId` vem do cliente: quem tem conta ativa e ainda não entrou nesta
  // pelada marca a si mesmo (ver podeDefinirPresencaPor em permissions.ts).
  if (!(await podeMarcarPor(session, matchDayId, playerId))) {
    redirect(`/pelada/${matchDayId}/gerenciar?erro=precisa-confirmar`);
  }
  await db
    .insert(attendances)
    .values({ matchDayId, playerId, status })
    .onConflictDoUpdate({
      target: [attendances.matchDayId, attendances.playerId],
      set: { status, updatedAt: new Date() },
    });
  revalidatePath("/");
  revalidatePath(`/pelada/${matchDayId}/gerenciar`);
  revalidatePath(`/pelada/${matchDayId}`);
}
