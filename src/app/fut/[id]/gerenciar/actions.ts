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
import {
  agendarAtualizacoesDeAgenda,
  agendarCancelamentosDeAgenda,
  agendarCancelamentosPosExclusao,
  agendarConvitesDeAgenda,
  lerDestinosDeCancelamento,
} from "@/lib/agenda-convite";
import { consumirPushDeAgenda } from "@/lib/agenda-freio";
import { criarJogadorComConvite, parseEmailDeConvite } from "@/lib/convites";
import { enviarConvitePorEmail } from "@/lib/email-convite";
import { isUniqueViolation } from "@/lib/db-errors";
import { redirectPosEnvio } from "@/app/redirect-pos-envio";
import { avisoDeTimesSorteados } from "@/lib/avisos-fut";
import { abrirVotacao, apagarFut, motivoExclusaoSchema } from "@/lib/deletion";
import { drawTeams } from "@/lib/draw";
import { formatDate } from "@/lib/format";
import { criarJogoComEscalacao } from "@/lib/jogos";
import { revalidateMatchDay } from "../revalidate";
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
  travarFut,
} from "@/lib/presenca";
import { FIM_DA_JANELA_CORRECAO } from "@/lib/janela-correcao";
import { TIMES_MAX, TIMES_MIN } from "@/lib/regras";
import { agendarDespachoDePush } from "@/lib/push-envio";
import { esquecerStats } from "@/lib/stats";
import { requireFutAdmin } from "@/lib/require-fut-admin";
import { podeCriarMaisJogador } from "@/lib/tetos-de-criacao";
import { defaultTeamNames } from "@/lib/team-colors";

export async function updateMatchDay(matchDayId: number, formData: FormData) {
  const { matchDay } = await requireFutAdmin(matchDayId);
  const parsed = parseMatchDayForm(formData);
  if (!parsed.success) redirect(`/fut/${matchDayId}/gerenciar?erro=dados-invalidos`);

  // O form manda "HH:MM" e o banco guarda "HH:MM:SS" — compara nos 5 primeiros.
  const horaAntiga = matchDay.startTime?.slice(0, 5) ?? null;
  const horaNova = parsed.data.startTime?.slice(0, 5) ?? null;
  const fimAntigo = matchDay.endTime?.slice(0, 5) ?? null;
  const fimNovo = parsed.data.endTime?.slice(0, 5) ?? null;
  // O término entra aqui junto com data/hora/local: sem ele, definir o fim de um
  // fut já marcado gravaria no banco e deixaria todo mundo com o bloco velho na
  // agenda, sem nunca ser avisado. É esta linha que faz a correção retroativa.
  const eventoMudou =
    parsed.data.date !== matchDay.date ||
    horaNova !== horaAntiga ||
    fimNovo !== fimAntigo ||
    parsed.data.location !== matchDay.location;

  let podeAvisar = true;
  const promovidos = await db.transaction(async (tx) => {
    await tx.update(matchDays).set(parsed.data).where(eq(matchDays.id, matchDayId));
    // Subir (ou limpar) o limite abre vagas sem ninguém sair. A espera sobe
    // aqui, na ordem de chegada — sem isto ela ficava parada, e o próximo "Vou"
    // entrava na frente de quem confirmou antes.
    const sobem = await preencherVagasAbertas(tx, matchDayId);
    await notificar(
      tx,
      sobem.map((p) => avisoDePromocao(matchDay, p)),
    );
    if (eventoMudou) {
      // Data/hora/término/local novos versionam o evento de todo mundo: a
      // atualização sai com SEQUENCE maior e o evento já na agenda se corrige
      // sozinho. O bump acontece mesmo com o freio acionado — a versão
      // acompanha a mudança real, e é o e-mail que fica para trás, não o dado.
      await tx
        .update(attendances)
        .set({ calendarSequence: sql`${attendances.calendarSequence} + 1` })
        .where(eq(attendances.matchDayId, matchDayId));
      podeAvisar = await consumirPushDeAgenda(tx, matchDayId);
    }
    return sobem;
  });
  if (promovidos.length > 0) agendarDespachoDePush(true);
  // Um e-mail por pessoa, e o certo para cada uma: quem já estava na lista
  // recebe "o fut mudou"; quem subiu da espera neste mesmo salvamento nunca teve
  // o evento, então recebe o convite — daí o `exceto`.
  if (eventoMudou && podeAvisar) agendarAtualizacoesDeAgenda(matchDayId, promovidos);
  if (promovidos.length > 0) agendarConvitesDeAgenda(matchDayId, promovidos);
  revalidatePath("/");
  revalidatePath(`/fut/${matchDayId}/gerenciar`);
  revalidatePath(`/fut/${matchDayId}`);
  // Salvou, mas ninguém foi avisado: quem administra precisa saber que a agenda
  // de quem confirmou continua com o dado velho até a cota virar.
  if (eventoMudou && !podeAvisar) {
    redirect(`/fut/${matchDayId}/gerenciar?ok=salvo-sem-avisar`);
  }
}

/**
 * Apaga o fut. Só vale para fut não encerrado — nele não há gol, V/E/D
 * nem avaliação de ninguém em jogo. Encerrado, quem decide é quem jogou, pela
 * votação (ver abrirVotacaoExclusao).
 */
export async function deleteMatchDay(matchDayId: number) {
  const { matchDay } = await requireFutAdmin(matchDayId);
  if (matchDay.status === "finished") {
    redirect(`/fut/${matchDayId}/gerenciar?erro=precisa-votacao`);
  }

  // Os destinos do cancelamento saem ANTES do delete: o cascade leva as
  // attendances junto, e depois não há de onde ler e-mail nem SEQUENCE.
  const destinos = await db.transaction(async (tx) => {
    const lidos = await lerDestinosDeCancelamento(tx, matchDayId);
    await tx.delete(matchDays).where(eq(matchDays.id, matchDayId));
    return lidos;
  });
  agendarCancelamentosPosExclusao(matchDay, destinos);

  revalidatePath("/");
  revalidatePath("/futs");
  redirect("/futs");
}

/**
 * Abre a votação para apagar um fut encerrado. Sem ninguém com conta que
 * tenha jogado, não há quem seja afetado — aí o admin apaga direto.
 */
export async function abrirVotacaoExclusao(matchDayId: number, formData: FormData) {
  const { session, matchDay } = await requireFutAdmin(matchDayId);
  const parsed = motivoExclusaoSchema.safeParse(formData.get("reason") ?? "");
  if (!parsed.success) redirect(`/fut/${matchDayId}/gerenciar?erro=motivo-curto`);

  if (matchDay.status !== "finished") {
    redirect(`/fut/${matchDayId}/gerenciar?erro=dados-invalidos`);
  }

  const resultado = await abrirVotacao(matchDayId, parsed.data, session.player.id);
  if (resultado.tipo === "prazo-encerrado") {
    redirect(`/fut/${matchDayId}/gerenciar?erro=exclusao-prazo-encerrado`);
  }
  if (resultado.tipo === "sem-eleitores") {
    // Mesmo sem eleitor, o fut pode ter rodada apurada e avaliações válidas
    // — basta as contas de quem jogou terem sido desativadas depois. O delete
    // leva as avaliações por cascade, então o replay tem que rodar no mesmo
    // commit, como em resolverVotacao(). Sem ele a nota de todo mundo ficaria
    // com a contribuição de um fut que não existe mais.
    //
    // O `pelada-` da chave é o nome antigo do domínio, mantido de propósito:
    // ela vira dedupe_key, e a unique (player_id, dedupe_key) é o que impede
    // re-notificar. Renomear sem backfill reavisaria todo mundo. Mesma regra
    // dos prefixos em avisos-fut.ts.
    await db.transaction((tx) => apagarFut(tx, matchDayId, `nota:pelada-apagada:${matchDayId}`));
    revalidatePath("/");
    revalidatePath("/futs");
    revalidatePath("/rankings");
    // O memo de src/lib/stats.ts guarda os agregados por até MEMO_TTL_MS; sem
    // isto, o ranking e o perfil público ficariam com o número velho por esse
    // tempo depois de uma mudança que os afeta.
    esquecerStats();
    redirect("/futs?ok=excluido-sem-votacao");
  }

  revalidateMatchDay(matchDayId);
  redirect(`/fut/${matchDayId}/gerenciar`);
}

// A escalação (times, jogos, quem jogou) é imutável depois do encerramento —
// é ela que define quem avalia quem, e mexer nela invalidaria avaliações já
// enviadas. Corrigir escalação errada só excluindo o fut.
function assertEscalacaoEditavel(matchDay: MatchDay) {
  if (matchDay.status === "finished") {
    redirect(`/fut/${matchDay.id}/gerenciar?erro=escalacao-travada`);
  }
}

// Placar e gols não mexem em quem avalia quem, então ganham uma janela depois
// do encerramento (JANELA_CORRECAO_HORAS, via FIM_DA_JANELA_CORRECAO).
// `finished_at` nulo num fut encerrado conta como fora da janela: sem marco
// temporal não há o que liberar.
const JANELA_CORRECAO = sql`
  ${matchDays.status} <> 'finished'
  or (${matchDays.finishedAt} is not null and ${FIM_DA_JANELA_CORRECAO} > now())
`;

async function assertPlacarEditavel(matchDayId: number) {
  const [row] = await db
    .select({ dentroDaJanela: sql<boolean>`${JANELA_CORRECAO}` })
    .from(matchDays)
    .where(eq(matchDays.id, matchDayId));
  // O requireFutAdmin viu o fut existir, mas ele pode ter sido apagado
  // entre o guard e esta query (votação aprovada, admin da plataforma) — sem o
  // `!row`, isso virava TypeError em vez de mensagem.
  if (!row || !row.dentroDaJanela) {
    redirect(`/fut/${matchDayId}/gerenciar?erro=janela-encerrada`);
  }
}


export async function drawTeamsAction(matchDayId: number, formData: FormData) {
  const { session, matchDay } = await requireFutAdmin(matchDayId);
  const teamCount = Number(formData.get("teamCount"));
  if (!Number.isInteger(teamCount) || teamCount < TIMES_MIN || teamCount > TIMES_MAX) {
    redirect(`/fut/${matchDayId}/gerenciar?erro=dados-invalidos`);
  }

  assertEscalacaoEditavel(matchDay);

  // Re-sortear apagaria os jogos por cascade — exige apagar os jogos antes.
  const existingGames = await db.select().from(games).where(eq(games.matchDayId, matchDayId));
  if (existingGames.length > 0) {
    redirect(`/fut/${matchDayId}/gerenciar?erro=jogos-lancados`);
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
    redirect(`/fut/${matchDayId}/gerenciar?erro=poucos-jogadores`);
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
  redirect(`/fut/${matchDayId}/gerenciar`);
}

export async function swapPlayersAction(matchDayId: number, formData: FormData) {
  const { matchDay } = await requireFutAdmin(matchDayId);
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
  const { matchDay } = await requireFutAdmin(matchDayId);
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
    redirect(`/fut/${matchDayId}/gerenciar?erro=dados-invalidos`);
  }

  const dayTeams = await db.select().from(teams).where(eq(teams.matchDayId, matchDayId));
  const teamIds = new Set(dayTeams.map((t) => t.id));
  if (!teamIds.has(teamAId) || !teamIds.has(teamBId)) {
    redirect(`/fut/${matchDayId}/gerenciar?erro=dados-invalidos`);
  }

  // Jogo e snapshot da escalação nascem juntos no helper — é o mesmo caminho
  // do iniciarJogo da súmula ao vivo (src/lib/jogos.ts).
  //
  // O fut é travado, e a contagem para o sortOrder roda DENTRO da transação,
  // pela mesma razão que lá: o snapshot sai de `team_players`, e sem o lock um
  // drawTeamsAction concorrente reescreve os times entre a leitura e o insert
  // da escalação — que é a fonte do V/E/D e do universo de avaliação.
  await db.transaction(async (tx) => {
    await travarFut(tx, matchDayId);
    const existing = await tx.select({ id: games.id }).from(games).where(eq(games.matchDayId, matchDayId));
    await criarJogoComEscalacao(tx, {
      matchDayId,
      teamAId,
      teamBId,
      scoreA,
      scoreB,
      sortOrder: existing.length,
    });
  });
  revalidateMatchDay(matchDayId);
}

export async function updateGameScore(matchDayId: number, gameId: number, formData: FormData) {
  await requireFutAdmin(matchDayId);
  await assertPlacarEditavel(matchDayId);
  const scoreA = Number(formData.get("scoreA"));
  const scoreB = Number(formData.get("scoreB"));
  if (!Number.isInteger(scoreA) || !Number.isInteger(scoreB) || scoreA < 0 || scoreB < 0) {
    redirect(`/fut/${matchDayId}/gerenciar?erro=dados-invalidos`);
  }
  await db
    .update(games)
    .set({ scoreA, scoreB })
    .where(and(eq(games.id, gameId), eq(games.matchDayId, matchDayId)));
  revalidateMatchDay(matchDayId);
}

export async function deleteGame(matchDayId: number, gameId: number) {
  const { matchDay } = await requireFutAdmin(matchDayId);
  assertEscalacaoEditavel(matchDay);
  await db.delete(games).where(and(eq(games.id, gameId), eq(games.matchDayId, matchDayId)));
  revalidateMatchDay(matchDayId);
}

export async function addGoal(matchDayId: number, gameId: number, formData: FormData) {
  const { session } = await requireFutAdmin(matchDayId);
  await assertPlacarEditavel(matchDayId);
  const playerId = Number(formData.get("playerId"));
  const quantity = Number(formData.get("quantity") ?? 1);
  if (!Number.isInteger(playerId) || !Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
    redirect(`/fut/${matchDayId}/gerenciar?erro=dados-invalidos`);
  }
  const [game] = await db
    .select()
    .from(games)
    .where(and(eq(games.id, gameId), eq(games.matchDayId, matchDayId)));
  if (!game) redirect(`/fut/${matchDayId}/gerenciar?erro=dados-invalidos`);

  // Escopo pelo jogo, na mesma linha do que deleteGoal faz com o goalId:
  // `playerId` vem do cliente, e sem isto daria para pendurar gol em quem nem
  // entrou em campo — a artilharia (src/lib/stats.ts) conta toda linha de gol
  // de fut encerrado, então seria placar inventado no ranking de alguém.
  const [escalado] = await db
    .select({ playerId: gamePlayers.playerId, side: gamePlayers.side })
    .from(gamePlayers)
    .where(and(eq(gamePlayers.gameId, gameId), eq(gamePlayers.playerId, playerId)));
  if (!escalado) redirect(`/fut/${matchDayId}/gerenciar?erro=artilheiro-fora-do-jogo`);

  // `side` e `createdByPlayerId` entram também por aqui para a auditoria e a
  // leitura por lado valerem nos dois fluxos, não só na súmula ao vivo.
  await db.insert(goals).values({
    gameId,
    playerId,
    quantity,
    side: escalado.side,
    createdByPlayerId: session.player.id,
  });
  revalidateMatchDay(matchDayId);
}

/**
 * Atribui autor a um gol que a súmula lançou como "gol contra / sem autor" —
 * o "atribuível depois" prometido pelo painel. Só para gol AINDA sem autor:
 * trocar autor errado continua sendo remover e lançar de novo, que deixa
 * rastro. Gol contra de verdade fica sem autor para sempre, e é por isso que o
 * candidato precisa ser do MESMO lado do gol: creditar artilharia a quem
 * marcou contra inverteria o sentido do registro.
 */
export async function definirAutorDoGol(matchDayId: number, goalId: number, formData: FormData) {
  await requireFutAdmin(matchDayId);
  await assertPlacarEditavel(matchDayId);
  const playerId = Number(formData.get("playerId"));
  if (!Number.isInteger(playerId) || !Number.isInteger(goalId)) {
    redirect(`/fut/${matchDayId}/gerenciar?erro=dados-invalidos`);
  }

  // Escopo pelo fut (goalId vem do cliente) + as condições de elegibilidade
  // da linha: ativa e sem autor.
  const [gol] = await db
    .select({ gameId: goals.gameId, side: goals.side })
    .from(goals)
    .innerJoin(games, and(eq(games.id, goals.gameId), eq(games.matchDayId, matchDayId)))
    .where(and(eq(goals.id, goalId), isNull(goals.playerId), isNull(goals.desfeitoEm)));
  if (!gol) redirect(`/fut/${matchDayId}/gerenciar?erro=dados-invalidos`);

  const [escalado] = await db
    .select({ side: gamePlayers.side })
    .from(gamePlayers)
    .where(and(eq(gamePlayers.gameId, gol.gameId), eq(gamePlayers.playerId, playerId)));
  if (!escalado || (gol.side !== null && escalado.side !== gol.side)) {
    redirect(`/fut/${matchDayId}/gerenciar?erro=artilheiro-fora-do-jogo`);
  }

  // O isNull repetido no WHERE é o guard de corrida de dois admins definindo
  // o autor ao mesmo tempo: o segundo update não encontra a linha e não
  // sobrescreve o primeiro.
  await db
    .update(goals)
    .set({ playerId })
    .where(and(eq(goals.id, goalId), isNull(goals.playerId)));
  revalidateMatchDay(matchDayId);
}

export async function deleteGoal(matchDayId: number, goalId: number) {
  await requireFutAdmin(matchDayId);
  await assertPlacarEditavel(matchDayId);
  // Escopo pelo fut: `goalId` vem do cliente, e sem o filtro um id de outra
  // fut — encerrado há meses — seria apagado por esta mesma chamada.
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
// escalação errada só se conserta excluindo o fut.

const convidadoSchema = z.object({
  // Sem quebra de linha, como no playerSchema de /admin/jogadores: o nome vira
  // o CN do ATTENDEE no .ics do convite de agenda (ver agenda.ts).
  name: z.string().trim().min(1, "Nome é obrigatório").max(60).regex(/^[^\r\n]+$/),
  isGoalkeeper: z.coerce.boolean(),
});

/**
 * Cadastra alguém novo e já marca a presença dele neste fut.
 *
 * É o que torna o admin de fut autônomo: apareceu gente nova na quadra, ele
 * resolve sem depender da plataforma. Só cria jogador **novo** — e jogador novo
 * nunca tem conta, então nunca é reset de senha disfarçado. O convite sai junto
 * e o link aparece na própria tela de gestão, para o organizador entregar na
 * mão, como sempre.
 */
export async function convidarParaFut(matchDayId: number, formData: FormData) {
  const { session, matchDay } = await requireFutAdmin(matchDayId);
  assertEscalacaoEditavel(matchDay);

  // Cadastrar jogador é auto-servível (basta criar um fut) e insere em
  // `players`, cujo `name` é UNIQUE — sem teto, dá para tomar nomes em massa.
  // Ver src/lib/tetos-de-criacao.ts.
  const ator = { playerId: session.player.id, isPlatformAdmin: session.isPlatformAdmin };
  if (!(await podeCriarMaisJogador(ator))) {
    redirect(`/fut/${matchDayId}/gerenciar?erro=muitos-jogadores`);
  }

  const parsed = convidadoSchema.safeParse({
    name: formData.get("name") ?? "",
    isGoalkeeper: formData.get("isGoalkeeper") === "on",
  });
  if (!parsed.success) redirect(`/fut/${matchDayId}/gerenciar?erro=dados-invalidos`);
  const email = parseEmailDeConvite(formData.get("email"));
  if (!email.success) redirect(`/fut/${matchDayId}/gerenciar?erro=email-invalido`);

  let token: string;
  try {
    token = await db.transaction(async (tx) => {
      const criado = await criarJogadorComConvite(tx, {
        name: parsed.data.name,
        nickname: null,
        isGoalkeeper: parsed.data.isGoalkeeper,
        email: email.data,
        createdByPlayerId: session.player.id,
      });
      // Passa pela lista como qualquer um: com o fut lotado e a lista aberta,
      // o convidado entra na espera. Um insert cru de `status: "in"` aqui furaria
      // o limite pelo caminho que ninguém olha.
      await entrarNaLista(tx, matchDay.id, criado.playerId);
      return criado.token;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      redirect(`/fut/${matchDayId}/gerenciar?erro=nome-duplicado`);
    }
    throw error;
  }

  // O envio fica fora da transação: falha de email não desfaz o cadastro, e um
  // rollback depois do envio mandaria um convite que não existe.
  const envio = email.data ? await enviarConvitePorEmail(token) : null;
  revalidateMatchDay(matchDayId);
  if (envio) redirectPosEnvio(`/fut/${matchDayId}/gerenciar`, envio);
}

/**
 * Reenvia por email um convite da lista "Convites para entregar" — mesmo token,
 * sem reemitir: o link já copiado segue valendo.
 *
 * O escopo pela presença neste fut é obrigatório: `playerId` vem do cliente,
 * e sem esse filtro um admin de fut reenviaria o convite de qualquer jogador
 * da plataforma. O leftJoin com `users` mantém a regra da lista: convite de quem
 * já tem conta é reset de senha, e isso é da plataforma. O escopo não é freio de
 * repetição — presença é auto-servível (ver definirPresenca); quem segura o
 * reenvio em loop é a janela por destinatário do enviarConvitePorEmail.
 *
 * Vencido ou sem email não aparece aqui: essa regra é do enviarConvitePorEmail,
 * que devolve `convite-inelegivel` para o mesmo banner.
 */
export async function reenviarConviteDoFut(matchDayId: number, playerId: number) {
  await requireFutAdmin(matchDayId);
  if (!Number.isInteger(playerId)) {
    redirect(`/fut/${matchDayId}/gerenciar?erro=dados-invalidos`);
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
  if (!invite) redirect(`/fut/${matchDayId}/gerenciar?erro=convite-nao-reenviavel`);

  const envio = await enviarConvitePorEmail(invite.token);
  revalidateMatchDay(matchDayId);
  redirectPosEnvio(`/fut/${matchDayId}/gerenciar`, envio);
}

export async function definirPresenca(
  matchDayId: number,
  playerId: number,
  status: "in" | "out",
) {
  const { session, matchDay } = await requireFutAdmin(matchDayId);
  assertEscalacaoEditavel(matchDay);
  if (!Number.isInteger(playerId)) {
    redirect(`/fut/${matchDayId}/gerenciar?erro=dados-invalidos`);
  }
  // `playerId` vem do cliente: quem tem conta ativa e ainda não entrou nesta
  // fut marca a si mesmo enquanto a lista está aberta; com ela fechada, o
  // admin inclui quem é elegível (ver podeDefinirPresencaPor em permissions.ts).
  const { permitido, alvo } = await avaliarMarcacao(session, matchDay, playerId);
  if (!permitido) {
    redirect(`/fut/${matchDayId}/gerenciar?erro=precisa-confirmar`);
  }

  // O aviso é o contrapeso da exceção da lista fechada, e por isso vai no MESMO
  // commit da presença: uma inclusão que grava e não avisa é justamente o que a
  // regra antiga existia para impedir.
  const avisar = status === "in" && mereceAviso(session, playerId, alvo);

  let houveAviso = avisar;
  let confirmado = false;
  let saiuDeVaga = false;
  let promovidoDaEspera: number | null = null;
  await db.transaction(async (tx) => {
    if (status === "in") {
      const entrada = await entrarNaLista(tx, matchDay.id, playerId);
      confirmado = entrada.para === "in" && entrada.de !== "in";
    } else {
      const saida = await sairDaLista(tx, matchDay.id, playerId);
      saiuDeVaga = saida.saiuDeVaga;
      if (saida.promovido !== null) {
        await notificar(tx, [avisoDePromocao(matchDay, saida.promovido)]);
        houveAviso = true;
        promovidoDaEspera = saida.promovido;
      }
    }

    if (avisar) {
      await notificar(tx, [
        {
          playerId,
          type: "pelada_presenca_definida",
          title: "Marcaram sua presença num fut",
          body: `${session.player.name} incluiu você no fut de ${formatDate(matchDay.date)}, em ${matchDay.location}.`,
          href: `/fut/${matchDayId}`,
          dedupeKey: `presenca:${matchDayId}:${playerId}`,
        },
      ]);
    }
  });
  if (houveAviso) agendarDespachoDePush(true);
  if (confirmado) agendarConvitesDeAgenda(matchDay.id, [playerId]);
  if (saiuDeVaga) agendarCancelamentosDeAgenda(matchDay.id, [playerId]);
  if (promovidoDaEspera !== null) agendarConvitesDeAgenda(matchDay.id, [promovidoDaEspera]);

  revalidatePath("/");
  revalidatePath(`/fut/${matchDayId}/gerenciar`);
  revalidatePath(`/fut/${matchDayId}`);
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
  const { matchDay } = await requireFutAdmin(matchDayId);
  assertEscalacaoEditavel(matchDay);
  if (!listaFechada(matchDay.status)) {
    redirect(`/fut/${matchDayId}/gerenciar?erro=lista-aberta`);
  }
  if (!Number.isInteger(playerId)) {
    redirect(`/fut/${matchDayId}/gerenciar?erro=dados-invalidos`);
  }

  const subiu = await db.transaction((tx) => subirDaEspera(tx, matchDayId, playerId));
  // Só quem subiu de fato ganha convite: quem já estava `in` não casa o `where`
  // do subirDaEspera e ficou com a SEQUENCE velha — o despacho, que procura por
  // status `in`, acharia a pessoa e mandaria um convite repetido.
  if (subiu) agendarConvitesDeAgenda(matchDayId, [playerId]);
  revalidateMatchDay(matchDayId);
}

/**
 * Registra que alguém confirmou e não apareceu — ou desfaz o registro.
 *
 * Só a partir do sorteio: antes dele o fut nem aconteceu, e quem desistiu
 * marca "Fora" sozinho. Tirar da vaga NÃO promove ninguém da espera, pelo mesmo
 * motivo do promoverDaEspera acima.
 *
 * O efeito prático é duplo: quem está como falta fica de fora do próximo sorteio
 * (drawTeamsAction só lê `in`) e não conta presença no ranking (src/lib/stats.ts).
 */
export async function marcarFalta(matchDayId: number, playerId: number, faltou: boolean) {
  const { matchDay } = await requireFutAdmin(matchDayId);
  assertEscalacaoEditavel(matchDay);
  if (!listaFechada(matchDay.status)) {
    redirect(`/fut/${matchDayId}/gerenciar?erro=lista-aberta`);
  }
  if (!Number.isInteger(playerId)) {
    redirect(`/fut/${matchDayId}/gerenciar?erro=dados-invalidos`);
  }

  await db.transaction((tx) => registrarFalta(tx, matchDayId, playerId, faltou));
  revalidateMatchDay(matchDayId);
}
