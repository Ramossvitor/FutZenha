import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
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
  // A nota é calculada pelas avaliações dos companheiros (ver src/lib/skill.ts)
  // — o admin não digita mais. Todo jogador começa em 5,0.
  skill: numeric("skill", { precision: 3, scale: 1, mode: "number" }).notNull().default(5),
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
  // Quem criou a pelada é quem a administra: presenças, sorteio, placar, gols,
  // encerramento e abertura da votação de exclusão (ver src/lib/permissions.ts).
  // Nulo em pelada órfã — as que existiam antes deste modelo e as de criador
  // apagado (`set null`, porque apagar jogador não pode apagar a pelada). Órfã
  // só é administrada pelo admin da plataforma.
  createdByPlayerId: integer("created_by_player_id").references(() => players.id, {
    onDelete: "set null",
  }),
  // Quando o admin confirmou a escalação e encerrou. A partir daqui a
  // escalação é imutável, e placar e gols têm 24h de janela para correção.
  finishedAt: timestamp("finished_at"),
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
  // Nulo em conta que nasceu pelo Google e nunca definiu senha. Os dois caminhos
  // convivem: quem já tinha senha continua entrando por ela até vincular o
  // Google, e é por isso que nem `password_hash` nem `google_sub` podem ser
  // obrigatórios — uma conta precisa é de pelo menos um dos dois.
  passwordHash: text("password_hash"),
  // Identificador estável da conta Google (claim `sub`). É por ele que o login
  // reconhece a pessoa: o email pode mudar de dono num domínio corporativo, o
  // `sub` não. Sempre em minúsculas, o email serve só para o primeiro encontro —
  // casar o convite e vincular quem já tinha conta de senha.
  email: text("email").unique(),
  googleSub: text("google_sub").unique(),
  tokenVersion: integer("token_version").notNull().default(1),
  active: boolean("active").notNull().default(true),
  // Admin da plataforma: gerencia contas e convites, julga denúncias de nota
  // injusta e supervisiona todas as peladas. É um jogador como qualquer outro —
  // marca a própria presença, avalia e é avaliado (e por isso não julga denúncia
  // de pelada que jogou, ver src/lib/permissions.ts). Ligar ou desligar vale no
  // request seguinte, sem mexer em token_version: o cookie não carrega papel, e
  // getSession relê esta coluna a cada request.
  isPlatformAdmin: boolean("is_platform_admin").notNull().default(false),
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
  // Email da conta Google que o admin quer convidar, em minúsculas. Preenchido,
  // o convite vira convite de Google e **só aquele email** o resgata — o link
  // corre num grupo de WhatsApp, então o token sozinho não pode bastar para
  // virar conta. Nulo, o convite segue no fluxo antigo de usuário e senha, que é
  // o que mantém válidos os links já entregues.
  email: text("email"),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Avaliação entre companheiros
//
// Encerrar uma pelada abre uma rodada. Cada jogador com conta avalia, de 1 a 5
// estrelas, os companheiros com quem dividiu o lado em algum jogo daquele dia.
// A rodada fecha quando todos avaliam ou quando o prazo vence, e a nota de
// todo mundo é recalculada do zero (ver src/lib/skill.ts).
// ---------------------------------------------------------------------------

export const ratingRoundStatusEnum = pgEnum("rating_round_status", [
  "open",
  "closed",
  "cancelled",
]);

export const ratingRoundCloseReasonEnum = pgEnum("rating_round_close_reason", [
  "todos_avaliaram",
  "prazo",
  "admin",
]);

export const ratingReportStatusEnum = pgEnum("rating_report_status", [
  "open",
  "accepted",
  "rejected",
]);

// "auto" = o admin deixou o prazo vencer, e o silêncio vale como aceite.
export const reportResolverEnum = pgEnum("report_resolver", ["admin", "auto"]);

export const notificationTypeEnum = pgEnum("notification_type", [
  "rating_round_open",
  "rating_round_closed",
  "skill_changed",
  "skill_recalculated",
  "rating_report_resolved",
  // A votação de exclusão tem os próprios tipos: `type` é a única classificação
  // legível por máquina da caixa de entrada, e reaproveitar os do ciclo de
  // avaliação gravaria linha mentindo sobre o que aconteceu.
  "deletion_vote_open",
  "deletion_vote_resolved",
]);

// Uma rodada por pelada — a unique em match_day_id é o que garante isso e o que
// torna a abertura idempotente. Os prazos são congelados na criação: nada de
// recalcular "agora + 2 dias" a cada leitura.
export const ratingRounds = pgTable(
  "rating_rounds",
  {
    id: serial("id").primaryKey(),
    matchDayId: integer("match_day_id")
      .notNull()
      .unique()
      .references(() => matchDays.id, { onDelete: "cascade" }),
    status: ratingRoundStatusEnum("status").notNull().default("open"),
    openedAt: timestamp("opened_at").notNull().defaultNow(),
    deadlineAt: timestamp("deadline_at").notNull(),
    closedAt: timestamp("closed_at"),
    reportDeadlineAt: timestamp("report_deadline_at"),
    closeReason: ratingRoundCloseReasonEnum("close_reason"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("rating_rounds_pendentes_idx").on(t.status, t.deadlineAt)],
);

// Denominador congelado do "todos já avaliaram": quem tinha conta ativa e
// companheiros para avaliar no momento em que a rodada abriu. Sem esta tabela o
// denominador mudaria embaixo do processo a cada conta criada ou desativada.
export const ratingRoundRaters = pgTable(
  "rating_round_raters",
  {
    roundId: integer("round_id")
      .notNull()
      .references(() => ratingRounds.id, { onDelete: "cascade" }),
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    submittedAt: timestamp("submitted_at"), // null = ainda não enviou
  },
  (t) => [primaryKey({ columns: [t.roundId, t.playerId] })],
);

// discarded_at null = avaliação válida. É assim que uma denúncia aceita tira a
// nota da conta sem apagar o registro.
export const ratings = pgTable(
  "ratings",
  {
    id: serial("id").primaryKey(),
    roundId: integer("round_id")
      .notNull()
      .references(() => ratingRounds.id, { onDelete: "cascade" }),
    raterPlayerId: integer("rater_player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    ratedPlayerId: integer("rated_player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    stars: integer("stars").notNull(),
    discardedAt: timestamp("discarded_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    // Um voto por par por rodada — permite reenviar (upsert) antes do prazo.
    unique().on(t.roundId, t.raterPlayerId, t.ratedPlayerId),
    check("ratings_stars_check", sql`${t.stars} between 1 and 5`),
    check("ratings_no_self_check", sql`${t.raterPlayerId} <> ${t.ratedPlayerId}`),
    index("ratings_round_rated_idx").on(t.roundId, t.ratedPlayerId),
    index("ratings_rated_idx").on(t.ratedPlayerId),
  ],
);

// Uma denúncia por avaliação. O prazo do admin é congelado na abertura; vencido
// sem resposta, o varredor aceita sozinho (resolved_by = 'auto').
export const ratingReports = pgTable(
  "rating_reports",
  {
    id: serial("id").primaryKey(),
    ratingId: integer("rating_id")
      .notNull()
      .unique()
      .references(() => ratings.id, { onDelete: "cascade" }),
    reporterPlayerId: integer("reporter_player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    reason: text("reason"),
    status: ratingReportStatusEnum("status").notNull().default("open"),
    openedAt: timestamp("opened_at").notNull().defaultNow(),
    adminDeadlineAt: timestamp("admin_deadline_at").notNull(),
    resolvedAt: timestamp("resolved_at"),
    // `resolved_by` diz COMO foi resolvida; `resolved_by_player_id`, QUEM
    // resolveu. As três combinações válidas:
    //   'admin' + id    → decisão humana identificada
    //   'admin' + null  → decisão pela senha global, que não tinha identidade
    //                     (linhas anteriores ao admin da plataforma)
    //   'auto'  + null  → silêncio no prazo, resolvida pelo varredor
    resolvedBy: reportResolverEnum("resolved_by"),
    resolvedByPlayerId: integer("resolved_by_player_id").references(() => players.id, {
      onDelete: "set null",
    }),
    adminNote: text("admin_note"),
  },
  (t) => [index("rating_reports_pendentes_idx").on(t.status, t.adminDeadlineAt)],
);

// Regravada inteira a cada replay — é projeção, não fonte de verdade. A nota
// inicial 5,0 é constante do motor e não vira linha aqui.
// average_received tem duas casas de propósito: a média das estrelas cai em
// valores como 6,63 e 9,55, que numeric(3,1) arredondaria.
export const skillHistory = pgTable(
  "skill_history",
  {
    id: serial("id").primaryKey(),
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    roundId: integer("round_id")
      .notNull()
      .references(() => ratingRounds.id, { onDelete: "cascade" }),
    skillBefore: numeric("skill_before", { precision: 3, scale: 1, mode: "number" }).notNull(),
    skillAfter: numeric("skill_after", { precision: 3, scale: 1, mode: "number" }).notNull(),
    ratingsCount: integer("ratings_count").notNull(),
    averageReceived: numeric("average_received", {
      precision: 4,
      scale: 2,
      mode: "number",
    }).notNull(),
    computedAt: timestamp("computed_at").notNull().defaultNow(),
  },
  (t) => [unique().on(t.playerId, t.roundId)],
);

// Caixa de entrada in-app. Aponta para player_id (e não user_id) para
// sobreviver a desativar/reativar a conta — e porque é o id que a sessão já
// tem em mãos. dedupe_key + unique é o que torna todo insert idempotente.
export const notifications = pgTable(
  "notifications",
  {
    id: serial("id").primaryKey(),
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    type: notificationTypeEnum("type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    href: text("href"),
    dedupeKey: text("dedupe_key").notNull(),
    readAt: timestamp("read_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.playerId, t.dedupeKey),
    index("notifications_inbox_idx").on(t.playerId, t.readAt),
  ],
);

// ---------------------------------------------------------------------------
// Exclusão de pelada por votação
//
// Escalação confirmada é imutável, e placar e gols travam 24h depois do
// encerramento. Passado isso, a única forma de consertar uma pelada errada é
// apagá-la inteira — e quem decide isso é quem jogou, não o admin sozinho.
// ---------------------------------------------------------------------------

export const deletionVoteStatusEnum = pgEnum("deletion_vote_status", [
  "open",
  "approved",
  "rejected",
]);

// Uma votação por pelada: a unique é o que garante que uma rejeitada não possa
// ser reaberta. Quórum e eleitorado são congelados na abertura, senão uma conta
// criada durante as 48h mudaria o denominador no meio da apuração.
export const matchDayDeletionVotes = pgTable("match_day_deletion_votes", {
  id: serial("id").primaryKey(),
  matchDayId: integer("match_day_id")
    .notNull()
    .unique()
    .references(() => matchDays.id, { onDelete: "cascade" }),
  reason: text("reason").notNull(),
  status: deletionVoteStatusEnum("status").notNull().default("open"),
  // Quem propôs. Nulo nas votações abertas pela senha global, que não tinha
  // identidade. Existe porque agora há um admin por pelada: "o admin propôs
  // apagar" deixou de identificar alguém.
  openedByPlayerId: integer("opened_by_player_id").references(() => players.id, {
    onDelete: "set null",
  }),
  openedAt: timestamp("opened_at").notNull().defaultNow(),
  deadlineAt: timestamp("deadline_at").notNull(),
  eligibleCount: integer("eligible_count").notNull(),
  requiredYes: integer("required_yes").notNull(),
  resolvedAt: timestamp("resolved_at"),
});

// Eleitorado congelado + o voto, no mesmo molde de rating_round_raters.
// in_favor null = ainda não votou, e não votar conta contra.
export const matchDayDeletionVoters = pgTable(
  "match_day_deletion_voters",
  {
    voteId: integer("vote_id")
      .notNull()
      .references(() => matchDayDeletionVotes.id, { onDelete: "cascade" }),
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    inFavor: boolean("in_favor"),
    votedAt: timestamp("voted_at"),
  },
  (t) => [primaryKey({ columns: [t.voteId, t.playerId] })],
);

export type Player = typeof players.$inferSelect;
export type MatchDay = typeof matchDays.$inferSelect;
export type Attendance = typeof attendances.$inferSelect;
export type Team = typeof teams.$inferSelect;
export type Game = typeof games.$inferSelect;
export type GamePlayer = typeof gamePlayers.$inferSelect;
export type Goal = typeof goals.$inferSelect;
export type User = typeof users.$inferSelect;
export type Invite = typeof invites.$inferSelect;
export type RatingRound = typeof ratingRounds.$inferSelect;
export type RatingRoundRater = typeof ratingRoundRaters.$inferSelect;
export type Rating = typeof ratings.$inferSelect;
export type RatingReport = typeof ratingReports.$inferSelect;
export type SkillHistoryEntry = typeof skillHistory.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type MatchDayDeletionVote = typeof matchDayDeletionVotes.$inferSelect;
export type MatchDayDeletionVoter = typeof matchDayDeletionVoters.$inferSelect;
export type NotificationType = (typeof notificationTypeEnum.enumValues)[number];
