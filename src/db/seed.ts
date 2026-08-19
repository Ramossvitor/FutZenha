import "dotenv/config";
import { randomBytes } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { companheirosPorJogador, gruposElegiveis } from "../lib/lineup";
import { hashPassword } from "../lib/password";
// Relativo e não "@/": o seed roda sob tsx, fora do Next. `regras.ts` é puro
// justamente para servir também a estes scripts.
import { PRAZO_AVALIACAO_HORAS } from "../lib/regras";
import { siteUrl } from "../lib/site-url";
import * as schema from "./schema";

// Este script APAGA todas as tabelas antes de popular. A trava evita destruir a
// fut real por uma DATABASE_URL de produção esquecida no terminal.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL não definida — o seed só roda contra o banco local.");
}
if (process.env.VERCEL || !/@(localhost|127\.0\.0\.1)[:/]/.test(databaseUrl)) {
  throw new Error(
    "O seed apaga todas as tabelas e só pode rodar contra o Postgres local " +
      "(docker compose). DATABASE_URL aponta para outro host — abortando.",
  );
}

const conn = postgres(databaseUrl, { max: 1, prepare: false });
const db = drizzle(conn, { schema });

// Sem nota: todo jogador nasce com 5,0 (default da coluna) e a nota só se
// move pelas avaliações dos companheiros.
const seedPlayers: Array<{
  name: string;
  nickname?: string;
  isGoalkeeper?: boolean;
}> = [
  { name: "André Souza", nickname: "Deco" },
  { name: "Bruno Lima" },
  { name: "Carlos Eduardo", nickname: "Cadu" },
  { name: "Diego Ferreira" },
  { name: "Eduardo Ramos", nickname: "Du" },
  { name: "Felipe Costa" },
  { name: "Gabriel Martins", nickname: "Biel" },
  { name: "Henrique Alves", isGoalkeeper: true },
  { name: "Igor Santana" },
  { name: "João Pedro", nickname: "JP" },
  { name: "Kleber Nunes", isGoalkeeper: true },
  { name: "Lucas Oliveira" },
  { name: "Marcos Vinícius", nickname: "Marquinhos" },
  { name: "Nando Ribeiro" },
  { name: "Otávio Mendes" },
  { name: "Paulo Sérgio", nickname: "PS", isGoalkeeper: true },
  { name: "Rafael Torres", nickname: "Rafa" },
  { name: "Thiago Barbosa" },
];

function isoDate(d: Date): string {
  const offset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - offset).toISOString().slice(0, 10);
}

function wednesdayShift(weeks: number): string {
  const now = new Date();
  const day = now.getDay();
  const toNextWednesday = (3 - day + 7) % 7 || 7;
  const date = new Date(now);
  date.setDate(now.getDate() + toNextWednesday + weeks * 7);
  return isoDate(date);
}

async function seedPastMatchDay(
  allPlayers: schema.Player[],
  date: string,
  rotation: number,
) {
  // Seleção "aleatória" determinística: gira a lista e pega 12.
  const rotated = [...allPlayers.slice(rotation), ...allPlayers.slice(0, rotation)];
  const goalkeepers = rotated.filter((p) => p.isGoalkeeper).slice(0, 2);
  const line = rotated.filter((p) => !p.isGoalkeeper).slice(0, 10);
  const confirmed = [...goalkeepers, ...line];

  const [matchDay] = await db
    .insert(schema.matchDays)
    .values({
      date,
      startTime: "20:00",
      endTime: "22:00",
      location: "Quadra do Zenha",
      status: "finished",
    })
    .returning();

  // `confirmedAt` escalonado pelo índice: a ordem da lista é ordem de chegada, e
  // um seed que grava todo mundo no mesmo instante esconderia qualquer erro de
  // ordenação atrás do desempate por id.
  await db.insert(schema.attendances).values(
    confirmed.map((p, i) => ({
      matchDayId: matchDay.id,
      playerId: p.id,
      status: "in" as const,
      confirmedAt: new Date(Date.now() - (confirmed.length - i) * 60_000),
    })),
  );
  const out = rotated.filter((p) => !confirmed.includes(p)).slice(0, 3);
  await db.insert(schema.attendances).values(
    out.map((p) => ({ matchDayId: matchDay.id, playerId: p.id, status: "out" as const })),
  );

  // Dois times: goleiro + linha alternada. Com todo mundo em 5,0 não há o que
  // balancear no seed — alternar já distribui os jogadores.
  const teamAPlayers = [goalkeepers[0], ...line.filter((_, i) => i % 2 === 0)];
  const teamBPlayers = [goalkeepers[1], ...line.filter((_, i) => i % 2 === 1)];

  const [teamA] = await db
    .insert(schema.teams)
    .values({ matchDayId: matchDay.id, name: "Preto", sortOrder: 0 })
    .returning();
  const [teamB] = await db
    .insert(schema.teams)
    .values({ matchDayId: matchDay.id, name: "Branco", sortOrder: 1 })
    .returning();
  await db.insert(schema.teamPlayers).values([
    ...teamAPlayers.map((p) => ({ teamId: teamA.id, playerId: p.id })),
    ...teamBPlayers.map((p) => ({ teamId: teamB.id, playerId: p.id })),
  ]);

  const scores: Array<[number, number]> = [
    [2 + (rotation % 2), 1],
    [0, 2],
    [1 + (rotation % 3), 1 + ((rotation + 1) % 2)],
  ];
  for (const [i, [scoreA, scoreB]] of scores.entries()) {
    const [game] = await db
      .insert(schema.games)
      .values({
        matchDayId: matchDay.id,
        teamAId: teamA.id,
        teamBId: teamB.id,
        scoreA,
        scoreB,
        sortOrder: i,
      })
      .returning();

    await db.insert(schema.gamePlayers).values([
      ...teamAPlayers.map((p) => ({ gameId: game.id, playerId: p.id, side: "A" as const })),
      ...teamBPlayers.map((p) => ({ gameId: game.id, playerId: p.id, side: "B" as const })),
    ]);

    // Autores: melhores da linha de cada time marcam (nem todo gol tem autor).
    const scorersA = teamAPlayers.slice(1, 1 + Math.min(scoreA, 2));
    const scorersB = teamBPlayers.slice(1, 1 + Math.min(scoreB, 2));
    const goalRows = [
      ...scorersA.map((p, j) => ({
        gameId: game.id,
        playerId: p.id,
        quantity: j === 0 ? Math.max(1, scoreA - scorersA.length + 1) : 1,
      })),
      ...scorersB.map((p, j) => ({
        gameId: game.id,
        playerId: p.id,
        quantity: j === 0 ? Math.max(1, scoreB - scorersB.length + 1) : 1,
      })),
    ];
    if (goalRows.length > 0) await db.insert(schema.goals).values(goalRows);
  }

  return matchDay;
}

// Abre a rodada de avaliação de um fut já encerrado. Repete os inserts do
// abrirRodada() em vez de importá-lo porque src/lib/ratings-engine.ts é
// "server-only" e não carrega num script tsx solto. A regra que importa —
// quem é companheiro de quem — vem do módulo puro compartilhado.
async function seedRatingRound(matchDayId: number) {
  const escalacao = await db
    .select({
      gameId: schema.gamePlayers.gameId,
      playerId: schema.gamePlayers.playerId,
      side: schema.gamePlayers.side,
    })
    .from(schema.gamePlayers)
    .innerJoin(schema.games, eq(schema.gamePlayers.gameId, schema.games.id))
    .where(eq(schema.games.matchDayId, matchDayId));

  const companheiros = companheirosPorJogador(escalacao);
  const todasAsContas = await db
    .select({ playerId: schema.users.playerId, userId: schema.users.id })
    .from(schema.users)
    .where(inArray(schema.users.playerId, [...companheiros.keys()]));

  // Mesma regra de getRatersElegiveis(): grupo de pelo menos 3 com conta ativa
  // no mesmo lado. Duplicar a chamada aqui é o preço de o motor ser
  // "server-only" e não carregar sob tsx — mas a regra em si vem do módulo puro.
  const elegiveis = gruposElegiveis(companheiros, new Set(todasAsContas.map((c) => c.playerId)));
  const contas = todasAsContas.filter((c) => elegiveis.has(c.playerId));
  if (contas.length === 0) return null;

  const [round] = await db
    .insert(schema.ratingRounds)
    .values({
      matchDayId,
      deadlineAt: sql`now() + make_interval(hours => 36)`,
    })
    .returning();
  await db.insert(schema.ratingRoundRaters).values(
    contas.map((c) => ({ roundId: round.id, playerId: c.playerId, userId: c.userId })),
  );
  await db.insert(schema.notifications).values(
    contas.map((c) => ({
      playerId: c.playerId,
      type: "rating_round_open" as const,
      title: "Avalie seus companheiros",
      body: `Você tem ${PRAZO_AVALIACAO_HORAS} horas para avaliar quem jogou com você.`,
      href: `/avaliar/${round.id}`,
      dedupeKey: `rodada:${round.id}:aberta`,
    })),
  );
  return { round, raters: contas.length };
}

async function main() {
  console.log("Limpando tabelas...");
  await db.delete(schema.matchDayDeletionVoters);
  await db.delete(schema.matchDayDeletionVotes);
  await db.delete(schema.notifications);
  await db.delete(schema.skillHistory);
  await db.delete(schema.ratingReports);
  await db.delete(schema.ratings);
  await db.delete(schema.ratingRoundRaters);
  await db.delete(schema.ratingRounds);
  await db.delete(schema.invites);
  await db.delete(schema.users);
  await db.delete(schema.goals);
  await db.delete(schema.gamePlayers);
  await db.delete(schema.games);
  await db.delete(schema.teamPlayers);
  await db.delete(schema.teams);
  await db.delete(schema.attendances);
  await db.delete(schema.matchDays);
  await db.delete(schema.players);

  console.log(`Inserindo ${seedPlayers.length} jogadores...`);
  const inserted = await db.insert(schema.players).values(seedPlayers).returning();

  console.log("Criando 3 futs passados encerrados...");
  await seedPastMatchDay(inserted, wednesdayShift(-3), 0);
  await seedPastMatchDay(inserted, wednesdayShift(-2), 5);
  const ultimoFut = await seedPastMatchDay(inserted, wednesdayShift(-1), 9);

  console.log("Criando o próximo fut com algumas presenças...");
  const [next] = await db
    .insert(schema.matchDays)
    .values({
      date: wednesdayShift(0),
      startTime: "20:00",
      endTime: "22:00",
      location: "Quadra do Zenha",
      status: "scheduled",
      // Com limite, e com mais gente confirmada do que vaga: é o único jeito de
      // o seed nascer com lista de espera para olhar.
      maxPlayers: 6,
    })
    .returning();
  await db.insert(schema.attendances).values(
    inserted.slice(0, 8).map((p, i) => ({
      matchDayId: next.id,
      playerId: p.id,
      status: i < 6 ? ("in" as const) : ("waitlist" as const),
      confirmedAt: new Date(Date.now() - (8 - i) * 3_600_000),
    })),
  );

  console.log("Criando contas demo e um convite pendente...");
  const byName = new Map(inserted.map((p) => [p.name, p]));

  // As contas demo vão para quatro jogadores do MESMO lado do último fut.
  // A avaliação exige grupo de 3 com conta (ver MIN_GRUPO_AVALIACAO): espalhar
  // as contas por times diferentes faria o seed nascer sem rodada nenhuma.
  const [ladoDaUltima] = await db
    .select({ playerId: schema.gamePlayers.playerId })
    .from(schema.gamePlayers)
    .innerJoin(schema.games, eq(schema.gamePlayers.gameId, schema.games.id))
    .where(eq(schema.games.matchDayId, ultimoFut.id))
    .limit(1);
  const mesmoLado = await db
    .select({ playerId: schema.gamePlayers.playerId })
    .from(schema.gamePlayers)
    .innerJoin(schema.games, eq(schema.gamePlayers.gameId, schema.games.id))
    .where(
      and(
        eq(schema.games.matchDayId, ultimoFut.id),
        eq(
          schema.gamePlayers.side,
          sql`(select side from game_players gp join games g on g.id = gp.game_id
               where g.match_day_id = ${ultimoFut.id} and gp.player_id = ${ladoDaUltima.playerId}
               limit 1)`,
        ),
      ),
    )
    .limit(4);

  const usernames = ["du", "ps", "cadu", "tico"].slice(0, mesmoLado.length);
  const senhaDemo = await hashPassword("senha123");
  await db.insert(schema.users).values(
    mesmoLado.slice(0, usernames.length).map((row, i) => ({
      playerId: row.playerId,
      username: usernames[i],
      passwordHash: senhaDemo,
      // Não é enfeite: sem endereço o app pede um em toda página (ver
      // AvisoDeEmailDeContato), e o ambiente local nasceria pedindo. @example.com
      // pela mesma razão das fixtures — se um envio escapar com key
      // configurada, não chega a caixa de gente de verdade.
      contactEmail: `${usernames[i]}@example.com`,
      // O primeiro é o admin da plataforma: o painel /admin precisa de dono, e
      // não existe mais senha global para entrar nele.
      isPlatformAdmin: i === 0,
    })),
  );
  const nomePorId = new Map(inserted.map((p) => [p.id, p.name]));
  const demo = usernames.map((u, i) => `${u} (${nomePorId.get(mesmoLado[i].playerId)})`);

  // Todo fut precisa de um admin: sem isso, o ambiente local nasce só com
  // futs órfãos e não dá para exercitar o papel de admin de fut.
  await db
    .update(schema.matchDays)
    .set({ createdByPlayerId: mesmoLado[0].playerId })
    .where(isNull(schema.matchDays.createdByPlayerId));
  const inviteToken = randomBytes(32).toString("base64url");
  await db.insert(schema.invites).values({
    token: inviteToken,
    playerId: byName.get("Rafael Torres")!.id,
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7),
  });
  console.log(`Logins demo (senha123): ${demo.join(" · ")}`);
  console.log(`Admin da plataforma: ${usernames[0]}`);
  console.log(`Convite de teste (Rafael Torres): ${siteUrl()}/convite/${inviteToken}`);

  const rodada = await seedRatingRound(ultimoFut.id);
  if (rodada) {
    console.log(
      `Rodada de avaliação #${rodada.round.id} aberta no fut de ${ultimoFut.date} ` +
        `(${rodada.raters} avaliadores): ${siteUrl()}/avaliar/${rodada.round.id}`,
    );
  }

  console.log("Seed concluído.");
  await conn.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
