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
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const matchDayStatusEnum = pgEnum("match_day_status", [
  "scheduled",
  "teams_drawn",
  "finished",
]);

// Os quatro estados possíveis de quem foi convidado para a lista. `in` é o
// único que conta em qualquer lugar: o sorteio (drawTeamsAction) e o ranking de
// presença (src/lib/stats.ts) filtram por ele, então espera e falta ficam de
// fora sem que nenhuma consulta precise saber que eles existem.
//
// - `in`       — na lista, dentro das vagas.
// - `out`      — desistiu (ou nunca entrou e o admin marcou fora).
// - `waitlist` — confirmou depois de as vagas acabarem. Sobe sozinho quando
//                alguém sai, enquanto a lista está aberta (ver lista-presenca.ts).
// - `no_show`  — confirmou e não apareceu. Marcado pelo admin a partir do
//                sorteio, ou detectado no encerramento em quem não entrou em
//                nenhum jogo. Não conta presença.
export const attendanceStatusEnum = pgEnum("attendance_status", [
  "in",
  "out",
  "waitlist",
  "no_show",
]);

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

// ---------------------------------------------------------------------------
// Grupos
//
// O grupo é o inquilino: futs, papéis e ranking próprios. Ele não substitui
// o ranking global — as estatísticas de todo fut encerrado continuam
// alimentando /rankings e /artilharia. O grupo é um recorte por cima disso (ver
// EscopoStats em src/lib/stats.ts).
//
// Fut sem grupo (`match_days.group_id` nulo) é o fut avulso, que é como o
// sistema inteiro funcionava antes disto e continua funcionando.
// ---------------------------------------------------------------------------

export const groupRoleEnum = pgEnum("group_role", ["admin", "organizer", "member"]);

export const groupVisibilityEnum = pgEnum("group_visibility", ["private", "public"]);

export const groupJoinPolicyEnum = pgEnum("group_join_policy", ["request", "open"]);

export const groupInvitationStatusEnum = pgEnum("group_invitation_status", [
  "pending",
  "accepted",
  "declined",
  "revoked",
]);

export const groupJoinRequestStatusEnum = pgEnum("group_join_request_status", [
  "pending",
  "approved",
  "rejected",
]);

export const groups = pgTable(
  "groups",
  {
    id: serial("id").primaryKey(),
    // Sem unique, de propósito. `players.name` é unique porque um jogador é uma
    // pessoa real dentro do mesmo fut; grupo é inquilino, e duas "Fut da
    // firma" convivem sem se confundir — o id desempata. Uma unique global
    // ainda viraria oráculo de enumeração: daria para descobrir a existência de
    // um grupo privado tentando criar um homônimo, que é justamente o que o 404
    // de `podeVerGrupo` esconde.
    name: text("name").notNull(),
    description: text("description"),
    // `private` não é descobrível e só entra por convite. `public` aparece em
    // /grupos, e aí `join_policy` decide como se entra.
    visibility: groupVisibilityEnum("visibility").notNull().default("private"),
    joinPolicy: groupJoinPolicyEnum("join_policy").notNull().default("request"),
    // Registro histórico de quem fundou. A autoridade sobre quem manda é
    // `group_members.role`, que se transfere; esta coluna, não.
    createdByPlayerId: integer("created_by_player_id").references(() => players.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("groups_descoberta_idx").on(t.visibility, t.name)],
);

export const groupMembers = pgTable(
  "group_members",
  {
    groupId: integer("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    role: groupRoleEnum("role").notNull().default("member"),
    joinedAt: timestamp("joined_at").notNull().defaultNow(),
  },
  (t) => [
    // A PK composta é o que torna "entrar no grupo" idempotente: os três
    // caminhos de entrada (link, convite nominal, pedido aprovado) usam
    // onConflictDoNothing, e nenhum deles duplica linha nem rebaixa para
    // "member" quem já era organizador.
    primaryKey({ columns: [t.groupId, t.playerId] }),
    index("group_members_player_idx").on(t.playerId),
    // Um admin por grupo, garantido pelo banco. É a última linha de defesa do
    // invariante que a aplicação já protege: sem ele, duas transferências
    // concorrentes deixariam o grupo com dois donos — ou, se a ordem das
    // statements se invertesse, com nenhum. Como o índice não é deferrable,
    // transferir é obrigatoriamente rebaixar o atual e só então promover o
    // alvo, nessa ordem e na mesma transação.
    uniqueIndex("group_members_admin_unico_idx")
      .on(t.groupId)
      .where(sql`role = 'admin'`),
  ],
);

// Convite por link, no molde de src/lib/convites.ts — com uma diferença que não
// pode ser perdida de vista: `invites` cria CONTA, este aqui só adiciona ao
// grupo uma conta que já existe, e por isso o resgate exige sessão. Se um dia
// isso virar cadastro, o link que corre solto no WhatsApp vira fábrica de contas.
export const groupInviteLinks = pgTable(
  "group_invite_links",
  {
    id: serial("id").primaryKey(),
    groupId: integer("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(), // 32 bytes aleatórios em base64url
    createdByPlayerId: integer("created_by_player_id").references(() => players.id, {
      onDelete: "set null",
    }),
    // Multi-uso de propósito: link que morre no primeiro clique é inútil num
    // grupo de WhatsApp com vinte pessoas. Nulo = sem teto.
    maxUses: integer("max_uses"),
    usesCount: integer("uses_count").notNull().default(0),
    expiresAt: timestamp("expires_at").notNull(),
    revokedAt: timestamp("revoked_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("group_invite_links_grupo_idx").on(t.groupId, t.revokedAt)],
);

// Convite nominal: o organizador escolhe a pessoa, e quem decide é ela.
// Separado de group_join_requests de propósito — são a mesma forma com
// decisores opostos, e numa tabela só todo `where` teria que carregar o
// discriminador. Um esquecimento ali vira escalada de privilégio: aprovar o
// próprio pedido pela rota de "aceitar convite".
export const groupInvitations = pgTable(
  "group_invitations",
  {
    id: serial("id").primaryKey(),
    groupId: integer("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    // Só jogador com conta ativa é convidável nominalmente (validado na action).
    // Quem não tem conta entra pelo fluxo do fut — convidarParaFut, que é
    // o que gera convite de plataforma.
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    invitedByPlayerId: integer("invited_by_player_id").references(() => players.id, {
      onDelete: "set null",
    }),
    status: groupInvitationStatusEnum("status").notNull().default("pending"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    respondedAt: timestamp("responded_at"),
    // Última vez que o aviso deste convite saiu por email. Nulo = nunca saiu
    // (envio não configurado, falhou ou bloqueado pelas janelas). Alimenta o
    // dedupe de reenvio, o teto diário combinado e o botão "Reenviar e-mail" —
    // espelho de invites.email_sent_at.
    emailSentAt: timestamp("email_sent_at"),
    // Para ONDE o aviso saiu, gravado junto com o carimbo. Espelha o papel de
    // `invites.email`: a janela global por caixa de entrada precisa de um
    // registro do que foi mandado, não de uma releitura da conta. Sem esta
    // coluna a janela lia `coalesce(users.email, users.contact_email)` ao vivo,
    // e qualquer um reescreve o próprio contact_email num request — bastava
    // trocá-lo depois de receber para a linha antiga parar de resolver para
    // aquele endereço, e uma segunda conta apontada para a mesma caixa passava
    // pelo freio dentro da janela.
    emailSentTo: text("email_sent_to"),
  },
  (t) => [
    // Um pendente por pessoa por grupo. Parcial e não total: quem recusou hoje
    // pode ser reconvidado no mês que vem, e o histórico das recusas fica.
    uniqueIndex("group_invitations_pendente_idx")
      .on(t.groupId, t.playerId)
      .where(sql`status = 'pending'`),
    index("group_invitations_convidado_idx").on(t.playerId, t.status),
  ],
);

// Pedido de entrada. Só existe em grupo público — grupo privado não tem fila de
// portaria, e é por isso que virar privado rejeita os pendentes.
export const groupJoinRequests = pgTable(
  "group_join_requests",
  {
    id: serial("id").primaryKey(),
    groupId: integer("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    status: groupJoinRequestStatusEnum("status").notNull().default("pending"),
    decidedByPlayerId: integer("decided_by_player_id").references(() => players.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    decidedAt: timestamp("decided_at"),
  },
  (t) => [
    uniqueIndex("group_join_requests_pendente_idx")
      .on(t.groupId, t.playerId)
      .where(sql`status = 'pending'`),
    index("group_join_requests_fila_idx").on(t.groupId, t.status),
  ],
);

export const matchDays = pgTable("match_days", {
  id: serial("id").primaryKey(),
  date: date("date").notNull(),
  startTime: time("start_time"),
  location: text("location").notNull(),
  status: matchDayStatusEnum("status").notNull().default("scheduled"),
  notes: text("notes"),
  // Nulo = fut avulso, que é como tudo funcionava antes dos grupos e continua
  // funcionando. Definido na criação e imutável depois: mover um fut
  // encerrada entre grupos reescreveria dois rankings de uma vez, e por isso
  // updateMatchDay não aceita este campo.
  //
  // `set null`, NUNCA `cascade`: apagar um grupo não pode apagar os futs
  // dele. Elas carregam gols, V/E/D, avaliações e skill_history que alimentam o
  // ranking GLOBAL — cascatear reescreveria a nota de gente que nem é do grupo,
  // e sem o aplicarReplay() que apagarFut roda no mesmo commit (ver
  // src/lib/deletion.ts).
  groupId: integer("group_id").references(() => groups.id, { onDelete: "set null" }),
  // Quem criou o fut é quem a administra: presenças, sorteio, placar, gols,
  // encerramento e abertura da votação de exclusão (ver src/lib/permissions.ts).
  // Nulo em fut órfão — os que existiam antes deste modelo e os de criador
  // apagado (`set null`, porque apagar jogador não pode apagar o fut). Órfã
  // só é administrada pelo admin da plataforma.
  createdByPlayerId: integer("created_by_player_id").references(() => players.id, {
    onDelete: "set null",
  }),
  // Quantos cabem. Nulo = sem limite, que é como todo fut funcionava antes da
  // lista de espera e continua funcionando. Com limite, quem confirma além dele
  // entra como `waitlist` — o corte é por ordem de chegada (`confirmed_at`), não
  // por nota nem por ordem alfabética.
  maxPlayers: integer("max_players"),
  // Quando o admin confirmou a escalação e encerrou. A partir daqui a
  // escalação é imutável, e placar e gols têm 24h de janela para correção.
  finishedAt: timestamp("finished_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
},
(t) => [
  // Todo recorte de grupo (futs do grupo e as quatro consultas de
  // src/lib/stats.ts) entra por group_id e ordena por data.
  index("match_days_group_idx").on(t.groupId, t.date),
]);

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
    // Quando esta pessoa entrou na lista. É a ordem de chegada — quem ocupa
    // vaga, quem fica na espera e quem sobe quando uma vaga abre saem daqui, e
    // não do `updated_at`, que qualquer edição do admin mexe.
    //
    // Zerado ao sair (`out`): quem desiste e volta atrás entra no fim da fila,
    // como na lista do WhatsApp. Nulo também em `out` que nunca chegou a entrar.
    confirmedAt: timestamp("confirmed_at"),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    // Versão do evento de agenda deste par (fut, jogador) — vira SEQUENCE no
    // .ics (ver src/lib/agenda.ts). Incrementada a cada transição da lista
    // (entrar, sair, promoção) e quando data/hora/local do fut mudam. Buracos
    // na contagem são inofensivos; o que importa é nunca repetir número num
    // UID — cliente estrito ignora REQUEST com SEQUENCE ≤ o do último CANCEL,
    // e é isso que faz "desmarquei e remarquei" reativar o evento.
    calendarSequence: integer("calendar_sequence").notNull().default(0),
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
  // A súmula ao vivo (/fut/[id]/sumula). Em andamento ⇔ `started_at` preenchido
  // e `finished_at` nulo. Jogo do fluxo clássico — placar digitado pronto no
  // /gerenciar — fica com os dois nulos e nunca é "em andamento", então nada
  // muda para os jogos já gravados. Dois timestamps, e não um enum de status,
  // porque o par também carrega o "desde 19h32" do painel e o carimbo de fim.
  startedAt: timestamp("started_at"),
  finishedAt: timestamp("finished_at"),
});

// Escalação do jogo: quem entrou em campo por qual lado. É um snapshot tirado
// dos times do fut na criação do jogo, então trocar alguém de colete depois
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
// gols individuais — isso cobre gol contra e gol de autor esquecido. A súmula
// ao vivo mantém os dois em sincronia ao lançar (mesma transação), mas o dado
// continua independente: o /gerenciar pode divergi-los de propósito.
export const goals = pgTable(
  "goals",
  {
    id: serial("id").primaryKey(),
    gameId: integer("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    // Nulo = gol contra / autor que ninguém viu: soma no placar sem creditar
    // artilharia (getTopScorers usa innerJoin em players, então sai sozinho).
    // O autor pode ser atribuído depois, no /gerenciar.
    playerId: integer("player_id").references(() => players.id, { onDelete: "cascade" }),
    // De que lado saiu o gol. Nulo nas linhas anteriores à súmula — para elas o
    // lado continua derivável pela escalação (game_players), como a página do
    // fut sempre fez. O check abaixo garante que gol sem autor tenha lado:
    // sem nenhum dos dois, a linha não diz nada.
    side: gameSideEnum("side"),
    quantity: integer("quantity").notNull().default(1),
    // O que separa os dois escritores de `goals`, e o único jeito de saber se
    // desfazer esta linha deve mexer no placar.
    //
    // `lancarGol` (súmula) incrementa `games.score*` no mesmo commit em que
    // insere: para as linhas dele, e SÓ para elas, o desfazer decrementa. O
    // `addGoal` do /gerenciar nunca toca no placar — lá o número é digitado à
    // parte — então uma linha dele decrementada seria placar comido de graça.
    // Não dá para inferir: as duas gravam `side` e `created_by_player_id`, e a
    // quantidade padrão do addGoal também é 1. Daí a coluna explícita.
    somadoNoPlacar: boolean("somado_no_placar").notNull().default(false),
    // Auditoria da súmula: quem lançou e quando. `set null` — apagar o
    // operador não apaga o gol de quem jogou.
    createdByPlayerId: integer("created_by_player_id").references(() => players.id, {
      onDelete: "set null",
    }),
    // Rows anteriores à migration 0019 foram backfilled com o timestamp do
    // deploy — este campo só é confiável para gol lançado a partir dela.
    createdAt: timestamp("created_at").notNull().defaultNow(),
    // O desfazer do painel é soft-delete: a linha fica, marcada com quem
    // desfez e quando — é o que dá ao admin o histórico completo (inclusive
    // das remoções, que é onde mora o abuso) sem uma tabela de eventos
    // paralela. Todo leitor de gols precisa filtrar `desfeito_em is null`;
    // o deleteGoal do /gerenciar continua hard delete (edição irrestrita).
    desfeitoEm: timestamp("desfeito_em"),
    desfeitoPorPlayerId: integer("desfeito_por_player_id").references(() => players.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    check("goals_autor_ou_lado", sql`${t.playerId} is not null or ${t.side} is not null`),
    index("goals_game_idx").on(t.gameId),
  ],
);

// Quem pode operar a súmula ao vivo além de quem gerencia o fut: o admin
// "passa a súmula" para quem está revezando. Escopo por fut, não por jogo —
// quem segura o celular fica com ele por vários jogos. Revogar é apagar a
// linha; a PK composta torna a delegação idempotente (onConflictDoNothing).
// O delegado NÃO ganha nenhum outro poder do /gerenciar.
export const sumulaOperadores = pgTable(
  "sumula_operadores",
  {
    matchDayId: integer("match_day_id")
      .notNull()
      .references(() => matchDays.id, { onDelete: "cascade" }),
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    // Registro da delegação: quem passou a súmula, e quando.
    createdByPlayerId: integer("created_by_player_id").references(() => players.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.matchDayId, t.playerId] }),
    index("sumula_operadores_player_idx").on(t.playerId),
  ],
);

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
  // Endereço para MANDAR e-mail — e só isso. Fica separado de `email` porque
  // aquele é credencial: um endereço auto-declarado gravado lá seria capturado
  // pelo login (ver decidirPorContas em src/lib/regras-login-google.ts — email
  // conhecido sem google_sub vira "vincular"), e bastaria digitar o Gmail de
  // outra pessoa para herdar a conta dela. Daí também a ausência de unique:
  // unicidade sobre dado que ninguém provou é ferramenta de bloqueio — eu
  // reivindico seu endereço e você fica sem. Quem envia lê os dois com
  // precedência do verificado (ver src/lib/email-destino.ts).
  contactEmail: text("contact_email"),
  tokenVersion: integer("token_version").notNull().default(1),
  active: boolean("active").notNull().default(true),
  // Admin da plataforma: gerencia contas e convites, julga denúncias de nota
  // injusta e supervisiona todos os futs. É um jogador como qualquer outro —
  // marca a própria presença, avalia e é avaliado (e por isso não julga denúncia
  // de fut que jogou, ver src/lib/permissions.ts). Ligar ou desligar vale no
  // request seguinte, sem mexer em token_version: o cookie não carrega papel, e
  // getSession relê esta coluna a cada request.
  isPlatformAdmin: boolean("is_platform_admin").notNull().default(false),
  // Primeira sessão desta conta vista rodando como app instalado (display-mode
  // standalone). Fica em users, não num storage do device, porque no iOS o PWA
  // instalado tem cookies/localStorage separados do Safari — é o login DENTRO
  // do app instalado que prova a instalação, e a flag na conta é o que faz o
  // convite de instalar sumir também no Safari. Não existe evento appinstalled
  // no iOS; esta é a única detecção confiável.
  pwaInstaladoEm: timestamp("pwa_instalado_em"),
  // Quando a pessoa abriu as instruções de instalar. Clicar ≠ instalar: sem a
  // flag de cima, o convite volta depois do snooze.
  pwaCtaClicadoEm: timestamp("pwa_cta_clicado_em"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Convite de cadastro, entregue por email (ver src/lib/email-convite.ts) ou
// copiado e mandado no WhatsApp. Se o jogador já tem conta, resgatar o convite =
// redefinir a senha. Um pendente por jogador.
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
  // Última vez que este convite saiu por email. Nulo = nunca saiu (envio não
  // configurado, ou falhou). É o que diz ao admin, dias depois do banner de
  // confirmação sumir, se ainda precisa entregar o link no WhatsApp. Convite
  // regenerado nasce nulo sozinho: gerarConvite apaga a linha e cria outra.
  emailSentAt: timestamp("email_sent_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Avaliação entre companheiros
//
// Encerrar um fut abre uma rodada. Cada jogador com conta avalia, de 0,5 a 5
// estrelas (de meia em meia), os companheiros com quem dividiu o lado em algum
// jogo daquele dia.
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
  // Grupos, pelo mesmo motivo acima: a caixa de entrada precisa distinguir "te
  // convidaram para um grupo" (que espera uma resposta sua) de "pediram para
  // entrar no seu grupo" (que espera uma decisão sua).
  "group_invitation",
  "group_join_request",
  "group_join_request_resolved",
  "group_role_changed",
  // Os quatro `pelada_*` abaixo guardam o nome antigo do domínio de propósito:
  // são valores de enum já gravados em `notifications.type` em produção.
  // Postgres não renomeia valor de enum sem migration, e o ganho seria
  // cosmético — nenhum deles aparece na tela. O domínio hoje se chama *fut*.
  // O tsc protege este ponto: o mapa ICONE de /notificacoes é
  // Record<TipoDeAviso, …>, então mexer numa chave por descuido não compila.
  //
  // O admin do fut incluiu alguém que não tinha entrado na lista por conta
  // própria. É o contrapeso da exceção em podeDefinirPresencaPor: a inclusão
  // mexe na presença e no V/E/D de quem tem conta, então a pessoa fica sabendo.
  "pelada_presenca_definida",
  // O ciclo de vida do fut em si — os três nasceram com o push, mas são
  // avisos de caixa de entrada como os outros: marcar fut novo, sortear os
  // times e a véspera sem resposta agora avisam quem joga.
  "pelada_criada",
  "pelada_times_sorteados",
  "pelada_lembrete_vespera",
  // Eleito melhor em campo na apuração da rodada. Nasce já com o nome novo do
  // domínio — só os quatro `pelada_*` acima carregam o legado.
  "mvp_do_fut",
]);

// Uma rodada por fut — a unique em match_day_id é o que garante isso e o que
// torna a abertura idempotente. Os prazos são congelados na criação: nada de
// recalcular "agora + prazo" a cada leitura.
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
    // Rodada apurada antes da meia estrela: os votos dela valem pela tabela
    // antiga (1★=1,0 … 5★=10,0 linear), congelada no motor. O replay ramifica
    // por esta flag — é o que impede a régua nova de reescrever nota passada.
    legacyScale: boolean("legacy_scale").notNull().default(false),
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
    // O voto de melhor em campo. A linha do avaliador congelado É o voto: a PK
    // já garante um por eleitor, e quem não avalia não tem onde votar. null =
    // não votou — inclui todo envio anterior à feature, que a apuração ignora.
    // `set null` no FK: apagar o votado evapora o voto sem derrubar a linha do
    // eleitorado, no espírito de "o resultado é função do que sobrou".
    mvpPlayerId: integer("mvp_player_id").references(() => players.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    primaryKey({ columns: [t.roundId, t.playerId] }),
    // O análogo do ratings_no_self_check: NULL <> x é NULL e o check passa,
    // então pendentes e envios legados continuam válidos.
    check("rating_round_raters_mvp_no_self_check", sql`${t.mvpPlayerId} <> ${t.playerId}`),
  ],
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
    // Meias-estrelas inteiras: 7 = 3,5★, 10 = 5★. A unidade é meia estrela para
    // toda a aritmética ficar em inteiros; em rodada `legacy_scale` só existem
    // valores pares (as estrelas inteiras da época, dobradas na migration).
    halfStars: integer("half_stars").notNull(),
    discardedAt: timestamp("discarded_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    // Um voto por par por rodada — permite reenviar (upsert) antes do prazo.
    unique().on(t.roundId, t.raterPlayerId, t.ratedPlayerId),
    check("ratings_half_stars_check", sql`${t.halfStars} between 1 and 10`),
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
    // Null = ainda não saiu por push: a caixa de entrada é também o outbox do
    // despacho (src/lib/push-envio.ts). notificar() não sabe disso — a linha
    // nasce pendente e o despachante marca depois do commit. A migration fez
    // backfill com now() para o histórico não virar rajada no primeiro deploy.
    pushDispatchedAt: timestamp("push_dispatched_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.playerId, t.dedupeKey),
    index("notifications_inbox_idx").on(t.playerId, t.readAt),
    // Parcial: o despacho só olha pendentes, e pendente é estado transitório —
    // o índice fica minúsculo em vez de repetir a tabela inteira.
    index("notifications_push_pendentes_idx")
      .on(t.id)
      .where(sql`push_dispatched_at is null`),
  ],
);

// Um device inscrito para receber push (Web Push/VAPID). O endpoint é a
// identidade do device — único, e a chave do upsert: o mesmo celular
// re-assinando (ou trocando de dono de sessão) atualiza a linha em vez de
// duplicar. player_id e não user_id pelo mesmo motivo de notifications, logo
// acima. Linha morta (endpoint expirado) é apagada pelo próprio despacho
// quando o push service responde 404/410.
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: serial("id").primaryKey(),
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull().unique(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    // Só para depurar "por que meu iPhone não recebe" — nunca entra em lógica.
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("push_subscriptions_player_idx").on(t.playerId)],
);

// ---------------------------------------------------------------------------
// Exclusão de fut por votação
//
// Escalação confirmada é imutável, e placar e gols travam 24h depois do
// encerramento. Passado isso, a única forma de consertar um fut errado é
// apagá-la inteira — e quem decide isso é quem jogou, não o admin sozinho.
// ---------------------------------------------------------------------------

export const deletionVoteStatusEnum = pgEnum("deletion_vote_status", [
  "open",
  "approved",
  "rejected",
]);

// Uma votação por fut: a unique é o que garante que uma rejeitada não possa
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
  // identidade. Existe porque agora há um admin por fut: "o admin propôs
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
export type Group = typeof groups.$inferSelect;
export type GroupMember = typeof groupMembers.$inferSelect;
export type GroupInviteLink = typeof groupInviteLinks.$inferSelect;
export type GroupInvitation = typeof groupInvitations.$inferSelect;
export type GroupJoinRequest = typeof groupJoinRequests.$inferSelect;
export type GroupRole = (typeof groupRoleEnum.enumValues)[number];
export type GroupVisibility = (typeof groupVisibilityEnum.enumValues)[number];
export type GroupJoinPolicy = (typeof groupJoinPolicyEnum.enumValues)[number];
export type MatchDay = typeof matchDays.$inferSelect;
export type Attendance = typeof attendances.$inferSelect;
export type Team = typeof teams.$inferSelect;
export type Game = typeof games.$inferSelect;
export type GamePlayer = typeof gamePlayers.$inferSelect;
export type Goal = typeof goals.$inferSelect;
export type SumulaOperador = typeof sumulaOperadores.$inferSelect;
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
