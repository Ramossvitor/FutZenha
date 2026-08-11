"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  attendances,
  gamePlayers,
  games,
  goals,
  invites,
  matchDays,
  players,
  teamPlayers,
  teams,
  users,
  type MatchDay,
} from "@/db/schema";
import { criarJogadorComConvite, parseEmailDeConvite } from "@/lib/convites";
import { enviarConvitePorEmail } from "@/lib/email-convite";
import { isUniqueViolation } from "@/lib/db-errors";
import { redirectPosEnvio } from "@/app/redirect-pos-envio";
import { avisoDeTimesSorteados } from "@/lib/avisos-pelada";
import { abrirVotacao, apagarPelada, motivoExclusaoSchema } from "@/lib/deletion";
import { drawTeams } from "@/lib/draw";
import { formatDate } from "@/lib/format";
import { listaFechada } from "@/lib/lista-presenca";
import { parseMatchDayForm } from "@/lib/match-day-form";
import { notificar } from "@/lib/notifications";
import {
  avaliarMarcacao,
  avisoDePromocao,
  entrarNaLista,
  mereceAviso,
  preencherVagasAbertas,
  registrarFalta,
  sairDaLista,
  subirDaEspera,
} from "@/lib/presenca";
import { agendarDespachoDePush } from "@/lib/push-envio";
import { requirePeladaAdmin } from "@/lib/require-pelada-admin";
import { defaultTeamNames } from "@/lib/team-colors";

export async function updateMatchDay(matchDayId: number, formData: FormData) {
  const { matchDay } = await requirePeladaAdmin(matchDayId);
  const parsed = parseMatchDayForm(formData);
  if (!parsed.success) redirect(`/pelada/${matchDayId}/gerenciar?erro=dados-invalidos`);

  const houvePromocao = await db.transaction(async (tx) => {
    await tx.update(matchDays).set(parsed.data).where(eq(matchDays.id, matchDayId));
    // Subir (ou limpar) o limite abre vagas sem ninguém sair. A espera sobe
    // aqui, na ordem de chegada — sem isto ela ficava parada, e o próximo "Vou"
    // entrava na frente de quem confirmou antes.
    const promovidos = await preencherVagasAbertas(tx, matchDayId);
    await notificar(
      tx,
      promovidos.map((p) => avisoDePromocao(matchDay, p)),
    );
    return promovidos.length > 0;
  });
  if (houvePromocao) agendarDespachoDePush(true);
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
  const { session, matchDay } = await requirePeladaAdmin(matchDayId);
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

    // Avisa quem está na lista e tem conta ativa — menos o admin que sorteou.
    // O dedupe segura o re-sorteio: quem já foi avisado uma vez não é avisado
    // de novo (correção não é novidade, ver avisoDeTimesSorteados).
    const comConta = await tx
      .select({ playerId: users.playerId })
      .from(users)
      .where(
        and(
          eq(users.active, true),
          // Quem sorteou já sabe — a exclusão fica no WHERE, como em
          // createMatchDay, e não num filter depois: um lugar só decide quem
          // recebe.
          ne(users.playerId, session.player.id),
          inArray(
            users.playerId,
            confirmed.map((c) => c.id),
          ),
        ),
      );
    await notificar(
      tx,
      comConta.map((c) => avisoDeTimesSorteados(matchDay, c.playerId)),
    );
  });
  agendarDespachoDePush(true);

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

  let token: string;
  try {
    token = await db.transaction(async (tx) => {
      const criado = await criarJogadorComConvite(tx, {
        name: parsed.data.name,
        nickname: null,
        isGoalkeeper: parsed.data.isGoalkeeper,
        email: email.data,
      });
      // Passa pela lista como qualquer um: com a pelada lotada e a lista aberta,
      // o convidado entra na espera. Um insert cru de `status: "in"` aqui furaria
      // o limite pelo caminho que ninguém olha.
      await entrarNaLista(tx, matchDay.id, criado.playerId);
      return criado.token;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      redirect(`/pelada/${matchDayId}/gerenciar?erro=nome-duplicado`);
    }
    throw error;
  }

  // O envio fica fora da transação: falha de email não desfaz o cadastro, e um
  // rollback depois do envio mandaria um convite que não existe.
  const envio = email.data ? await enviarConvitePorEmail(token) : null;
  revalidateMatchDay(matchDayId);
  if (envio) redirectPosEnvio(`/pelada/${matchDayId}/gerenciar`, envio);
}

/**
 * Reenvia por email um convite da lista "Convites para entregar" — mesmo token,
 * sem reemitir: o link já copiado segue valendo.
 *
 * O escopo pela presença nesta pelada é obrigatório: `playerId` vem do cliente,
 * e sem esse filtro um admin de pelada reenviaria o convite de qualquer jogador
 * da plataforma. O leftJoin com `users` mantém a regra da lista: convite de quem
 * já tem conta é reset de senha, e isso é da plataforma. O escopo não é freio de
 * repetição — presença é auto-servível (ver definirPresenca); quem segura o
 * reenvio em loop é a janela por destinatário do enviarConvitePorEmail.
 *
 * Vencido ou sem email não aparece aqui: essa regra é do enviarConvitePorEmail,
 * que devolve `convite-inelegivel` para o mesmo banner.
 */
export async function reenviarConviteDaPelada(matchDayId: number, playerId: number) {
  await requirePeladaAdmin(matchDayId);
  if (!Number.isInteger(playerId)) {
    redirect(`/pelada/${matchDayId}/gerenciar?erro=dados-invalidos`);
  }

  const [invite] = await db
    .select({ token: invites.token })
    .from(invites)
    .innerJoin(attendances, eq(attendances.playerId, invites.playerId))
    .leftJoin(users, eq(users.playerId, invites.playerId))
    .where(
      and(
        eq(invites.playerId, playerId),
        eq(attendances.matchDayId, matchDayId),
        isNull(invites.usedAt),
        isNull(users.id),
      ),
    );
  if (!invite) redirect(`/pelada/${matchDayId}/gerenciar?erro=convite-nao-reenviavel`);

  const envio = await enviarConvitePorEmail(invite.token);
  revalidateMatchDay(matchDayId);
  redirectPosEnvio(`/pelada/${matchDayId}/gerenciar`, envio);
}

export async function definirPresenca(
  matchDayId: number,
  playerId: number,
  status: "in" | "out",
) {
  const { session, matchDay } = await requirePeladaAdmin(matchDayId);
  assertEscalacaoEditavel(matchDay);
  if (!Number.isInteger(playerId)) {
    redirect(`/pelada/${matchDayId}/gerenciar?erro=dados-invalidos`);
  }
  // `playerId` vem do cliente: quem tem conta ativa e ainda não entrou nesta
  // pelada marca a si mesmo enquanto a lista está aberta; com ela fechada, o
  // admin inclui quem é elegível (ver podeDefinirPresencaPor em permissions.ts).
  const { permitido, alvo } = await avaliarMarcacao(session, matchDay, playerId);
  if (!permitido) {
    redirect(`/pelada/${matchDayId}/gerenciar?erro=precisa-confirmar`);
  }

  // O aviso é o contrapeso da exceção da lista fechada, e por isso vai no MESMO
  // commit da presença: uma inclusão que grava e não avisa é justamente o que a
  // regra antiga existia para impedir.
  const avisar = status === "in" && mereceAviso(session, playerId, alvo);

  let houveAviso = avisar;
  await db.transaction(async (tx) => {
    if (status === "in") {
      await entrarNaLista(tx, matchDay.id, playerId);
    } else {
      const promovido = await sairDaLista(tx, matchDay.id, playerId);
      if (promovido !== null) {
        await notificar(tx, [avisoDePromocao(matchDay, promovido)]);
        houveAviso = true;
      }
    }

    if (avisar) {
      await notificar(tx, [
        {
          playerId,
          type: "pelada_presenca_definida",
          title: "Marcaram sua presença numa pelada",
          body: `${session.player.name} incluiu você na pelada de ${formatDate(matchDay.date)}, em ${matchDay.location}.`,
          href: `/pelada/${matchDayId}`,
          dedupeKey: `presenca:${matchDayId}:${playerId}`,
        },
      ]);
    }
  });
  if (houveAviso) agendarDespachoDePush(true);

  revalidatePath("/");
  revalidatePath(`/pelada/${matchDayId}/gerenciar`);
  revalidatePath(`/pelada/${matchDayId}`);
}

/**
 * Sobe alguém da espera para uma vaga.
 *
 * Só com a lista fechada, e é aí que está o sentido: aberta, a promoção acontece
 * sozinha quando alguém sai (ver sairDaLista). Fechada, quem decide é o admin,
 * porque a vaga que abriu é de quem apareceu na quadra — e disso o banco não
 * sabe nada.
 */
export async function promoverDaEspera(matchDayId: number, playerId: number) {
  const { matchDay } = await requirePeladaAdmin(matchDayId);
  assertEscalacaoEditavel(matchDay);
  if (!listaFechada(matchDay.status)) {
    redirect(`/pelada/${matchDayId}/gerenciar?erro=lista-aberta`);
  }
  if (!Number.isInteger(playerId)) {
    redirect(`/pelada/${matchDayId}/gerenciar?erro=dados-invalidos`);
  }

  await db.transaction((tx) => subirDaEspera(tx, matchDayId, playerId));
  revalidateMatchDay(matchDayId);
}

/**
 * Registra que alguém confirmou e não apareceu — ou desfaz o registro.
 *
 * Só a partir do sorteio: antes dele a pelada nem aconteceu, e quem desistiu
 * marca "Fora" sozinho. Tirar da vaga NÃO promove ninguém da espera, pelo mesmo
 * motivo do promoverDaEspera acima.
 *
 * O efeito prático é duplo: quem está como falta fica de fora do próximo sorteio
 * (drawTeamsAction só lê `in`) e não conta presença no ranking (src/lib/stats.ts).
 */
export async function marcarFalta(matchDayId: number, playerId: number, faltou: boolean) {
  const { matchDay } = await requirePeladaAdmin(matchDayId);
  assertEscalacaoEditavel(matchDay);
  if (!listaFechada(matchDay.status)) {
    redirect(`/pelada/${matchDayId}/gerenciar?erro=lista-aberta`);
  }
  if (!Number.isInteger(playerId)) {
    redirect(`/pelada/${matchDayId}/gerenciar?erro=dados-invalidos`);
  }

  await db.transaction((tx) => registrarFalta(tx, matchDayId, playerId, faltou));
  revalidateMatchDay(matchDayId);
}
