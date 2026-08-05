import {
  boolean,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  time,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

export const matchDayStatusEnum = pgEnum("match_day_status", [
  "scheduled",
  "teams_drawn",
  "finished",
]);

export const attendanceStatusEnum = pgEnum("attendance_status", ["in", "out"]);

export const gameSideEnum = pgEnum("game_side", ["A", "B"]);

export const players = pgTable("players", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  nickname: text("nickname"),
  skill: integer("skill").notNull().default(5),
  isGoalkeeper: boolean("is_goalkeeper").notNull().default(false),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const matchDays = pgTable("match_days", {
  id: serial("id").primaryKey(),
  date: date("date").notNull(),
  startTime: time("start_time"),
  location: text("location").notNull(),
  status: matchDayStatusEnum("status").notNull().default("scheduled"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const attendances = pgTable(
  "attendances",
  {
    id: serial("id").primaryKey(),
    matchDayId: integer("match_day_id")
      .notNull()
      .references(() => matchDays.id, { onDelete: "cascade" }),
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    status: attendanceStatusEnum("status").notNull().default("in"),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [unique().on(t.matchDayId, t.playerId)],
);

export const teams = pgTable("teams", {
  id: serial("id").primaryKey(),
  matchDayId: integer("match_day_id")
    .notNull()
    .references(() => matchDays.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const teamPlayers = pgTable(
  "team_players",
  {
    teamId: integer("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.playerId] })],
);

export const games = pgTable("games", {
  id: serial("id").primaryKey(),
  matchDayId: integer("match_day_id")
    .notNull()
    .references(() => matchDays.id, { onDelete: "cascade" }),
  teamAId: integer("team_a_id")
    .notNull()
    .references(() => teams.id, { onDelete: "cascade" }),
  teamBId: integer("team_b_id")
    .notNull()
    .references(() => teams.id, { onDelete: "cascade" }),
  scoreA: integer("score_a").notNull().default(0),
  scoreB: integer("score_b").notNull().default(0),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Escalação do jogo: quem entrou em campo por qual lado. É um snapshot tirado
// dos times da pelada na criação do jogo, então trocar alguém de colete depois
// não reescreve quem jogou os jogos anteriores. É daqui que saem os
// "companheiros de equipe" da avaliação e o V/E/D de cada jogador.
export const gamePlayers = pgTable(
  "game_players",
  {
    gameId: integer("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    side: gameSideEnum("side").notNull(),
  },
  (t) => [
    // A PK composta é o que impede o mesmo jogador nos dois lados do jogo.
    primaryKey({ columns: [t.gameId, t.playerId] }),
    index("game_players_player_idx").on(t.playerId),
  ],
);

// O placar do jogo é digitado pelo admin e não precisa bater com a soma dos
// gols individuais — isso cobre gol contra e gol de autor esquecido.
export const goals = pgTable("goals", {
  id: serial("id").primaryKey(),
  gameId: integer("game_id")
    .notNull()
    .references(() => games.id, { onDelete: "cascade" }),
  playerId: integer("player_id")
    .notNull()
    .references(() => players.id, { onDelete: "cascade" }),
  quantity: integer("quantity").notNull().default(1),
});

// Conta de acesso de um jogador (1:1 com players). username é sempre salvo em
// minúsculas (normalizado na aplicação). token_version invalida sessões antigas
// ao trocar/resetar a senha; active=false derruba a sessão no próximo request.
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id")
    .notNull()
    .unique()
    .references(() => players.id, { onDelete: "cascade" }),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  tokenVersion: integer("token_version").notNull().default(1),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Convite de cadastro enviado pelo admin via WhatsApp. Se o jogador já tem
// conta, resgatar o convite = redefinir a senha. Um pendente por jogador.
export const invites = pgTable("invites", {
  id: serial("id").primaryKey(),
  token: text("token").notNull().unique(), // 32 bytes aleatórios em base64url
  playerId: integer("player_id")
    .notNull()
    .references(() => players.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type Player = typeof players.$inferSelect;
export type MatchDay = typeof matchDays.$inferSelect;
export type Attendance = typeof attendances.$inferSelect;
export type Team = typeof teams.$inferSelect;
export type Game = typeof games.$inferSelect;
export type GamePlayer = typeof gamePlayers.$inferSelect;
export type Goal = typeof goals.$inferSelect;
export type User = typeof users.$inferSelect;
export type Invite = typeof invites.$inferSelect;
