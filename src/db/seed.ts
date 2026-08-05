import "dotenv/config";
import { randomBytes } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { hashPassword } from "../lib/password";
import { siteUrl } from "../lib/site-url";
import * as schema from "./schema";

// Este script APAGA todas as tabelas antes de popular. A trava evita destruir a
// pelada real por uma DATABASE_URL de produção esquecida no terminal.
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
    .values({ date, startTime: "20:00", location: "Quadra do Zenha", status: "finished" })
    .returning();

  await db.insert(schema.attendances).values(
    confirmed.map((p) => ({ matchDayId: matchDay.id, playerId: p.id, status: "in" as const })),
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
}

async function main() {
  console.log("Limpando tabelas...");
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

  console.log("Criando 3 peladas passadas encerradas...");
  await seedPastMatchDay(inserted, wednesdayShift(-3), 0);
  await seedPastMatchDay(inserted, wednesdayShift(-2), 5);
  await seedPastMatchDay(inserted, wednesdayShift(-1), 9);

  console.log("Criando a próxima pelada com algumas presenças...");
  const [next] = await db
    .insert(schema.matchDays)
    .values({
      date: wednesdayShift(0),
      startTime: "20:00",
      location: "Quadra do Zenha",
      status: "scheduled",
    })
    .returning();
  await db.insert(schema.attendances).values(
    inserted.slice(0, 8).map((p) => ({
      matchDayId: next.id,
      playerId: p.id,
      status: "in" as const,
    })),
  );

  console.log("Criando contas demo e um convite pendente...");
  const byName = new Map(inserted.map((p) => [p.name, p]));
  await db.insert(schema.users).values([
    {
      playerId: byName.get("Eduardo Ramos")!.id,
      username: "du",
      passwordHash: await hashPassword("senha123"),
    },
    {
      playerId: byName.get("Paulo Sérgio")!.id,
      username: "ps",
      passwordHash: await hashPassword("senha123"),
    },
  ]);
  const inviteToken = randomBytes(32).toString("base64url");
  await db.insert(schema.invites).values({
    token: inviteToken,
    playerId: byName.get("Rafael Torres")!.id,
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7),
  });
  console.log("Logins demo: du / senha123 · ps / senha123");
  console.log(`Convite de teste (Rafael Torres): ${siteUrl()}/convite/${inviteToken}`);

  console.log("Seed concluído.");
  await conn.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
