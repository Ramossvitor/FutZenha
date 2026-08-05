import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const conn = postgres(process.env.DATABASE_URL!, { max: 1 });
const db = drizzle(conn, { schema });

const seedPlayers: Array<{
  name: string;
  nickname?: string;
  skill: number;
  isGoalkeeper?: boolean;
}> = [
  { name: "André Souza", nickname: "Deco", skill: 8 },
  { name: "Bruno Lima", skill: 6 },
  { name: "Carlos Eduardo", nickname: "Cadu", skill: 7 },
  { name: "Diego Ferreira", skill: 5 },
  { name: "Eduardo Ramos", nickname: "Du", skill: 9 },
  { name: "Felipe Costa", skill: 4 },
  { name: "Gabriel Martins", nickname: "Biel", skill: 7 },
  { name: "Henrique Alves", skill: 3, isGoalkeeper: true },
  { name: "Igor Santana", skill: 6 },
  { name: "João Pedro", nickname: "JP", skill: 8 },
  { name: "Kleber Nunes", skill: 5, isGoalkeeper: true },
  { name: "Lucas Oliveira", skill: 6 },
  { name: "Marcos Vinícius", nickname: "Marquinhos", skill: 7 },
  { name: "Nando Ribeiro", skill: 4 },
  { name: "Otávio Mendes", skill: 5 },
  { name: "Paulo Sérgio", nickname: "PS", skill: 6, isGoalkeeper: true },
  { name: "Rafael Torres", nickname: "Rafa", skill: 8 },
  { name: "Thiago Barbosa", skill: 5 },
];

async function main() {
  console.log("Limpando tabelas...");
  await db.delete(schema.goals);
  await db.delete(schema.games);
  await db.delete(schema.teamPlayers);
  await db.delete(schema.teams);
  await db.delete(schema.attendances);
  await db.delete(schema.matchDays);
  await db.delete(schema.players);

  console.log(`Inserindo ${seedPlayers.length} jogadores...`);
  await db.insert(schema.players).values(seedPlayers);

  console.log("Seed concluído.");
  await conn.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
