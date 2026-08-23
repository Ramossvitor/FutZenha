import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  customType,
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

export const players = pgTable(
  "players",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull().unique(),
    nickname: text("nickname"),
    // A nota é calculada pelas avaliações dos companheiros (ver src/lib/skill.ts)
    // — o admin não digita mais. Todo jogador começa em 5,0.
    skill: numeric("skill", { precision: 3, scale: 1, mode: "number" }).notNull().default(5),
    isGoalkeeper: boolean("is_goalkeeper").notNull().default(false),
    active: boolean("active").notNull().default(true),
    // Quem cadastrou este jogador. Espelho do `groups.created_by_player_id`, e
    // `set null` pelo mesmo motivo: apagar quem convidou não pode apagar quem
    // foi convidado.
    //
    // Serve a duas coisas que não são cosméticas. A primeira é o teto diário de
    // src/lib/tetos-de-criacao.ts: `convidarParaFut` cria linha em `players` com
    // nome à escolha e sem limite, e sem esta coluna não há por quem contar. A
    // segunda é auditoria — `players.name` é UNIQUE, então cadastrar nome é
    // tomar nome, e quando um nome vira alvo de disputa (ver a trava de squat em
    // src/db/platform-admins-bootstrap.ts) esta coluna é a única testemunha de
    // quem chegou primeiro. Nulo no que veio antes dela e no que o seed cria.
    createdByPlayerId: integer("created_by_player_id").references((): AnyPgColumn => players.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    // O teto diário pergunta "quantos este jogador criou nas últimas 24h".
    index("players_criador_idx").on(t.createdByPlayerId, t.createdAt),
  ],
);

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
  (t) => [
    index("groups_descoberta_idx").on(t.visibility, t.name),
    // O teto diário de criação de grupo — ver src/lib/tetos-de-criacao.ts.
    index("groups_criador_idx").on(t.createdByPlayerId, t.createdAt),
  ],
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
  // Quando o fut acaba. Nulo = quem marcou não disse, e o evento de agenda cai
  // no DURACAO_PADRAO_MIN de src/lib/agenda.ts. Fim <= início é virada de
  // meia-noite (22:00 às 00:30), não erro — quem separa um do outro é o
  // match_days_duracao_check aqui embaixo.
  endTime: time("end_time"),
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
  // Freio do aviso de agenda: quantas atualizações em massa este fut já disparou
  // na janela que começou em `calendar_pushes_since`. Mudar data/hora/local
  // reescreve o evento na agenda de TODO mundo que confirmou, e nada impedia
  // quem administra de salvar o formulário cinquenta vezes seguidas. Ver
  // src/lib/agenda-freio.ts.
  calendarPushes: integer("calendar_pushes").notNull().default(0),
  calendarPushesSince: timestamp("calendar_pushes_since"),
  // Quando a zenha deste fut foi paga. Nulo = ainda não foi.
  //
  // Faz duas coisas. A primeira é ser a trava do exatamente-uma-vez: a
  // liquidação abre com `UPDATE ... SET liquidado_em = now() WHERE id = $1 AND
  // liquidado_em IS NULL RETURNING`, e zero linhas quer dizer que outra
  // execução já pagou. A segunda é limitar a varredura — sem ela, o varredor
  // reexaminaria todo fut encerrado da história a cada passada.
  liquidadoEm: timestamp("liquidado_em"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
},
(t) => [
  // Todo recorte de grupo (futs do grupo e as quatro consultas de
  // src/lib/stats.ts) entra por group_id e ordena por data.
  index("match_days_group_idx").on(t.groupId, t.date),
  // O teto diário de criação de fut — ver src/lib/tetos-de-criacao.ts.
  index("match_days_criador_idx").on(t.createdByPlayerId, t.createdAt),
  // A trava de verdade da duração — o zod de match-day-form.ts dá a mensagem,
  // este check dá a garantia. Quem administra o fut consegue reescrever o evento
  // na agenda de quem confirmou; sem teto, "das 8h às 23h de sexta a domingo"
  // seria um bloqueio válido. Fim <= início soma 24h (virada de meia-noite), e
  // é esse ramo que torna multi-dia inexprimível: com teto de 6h não existe
  // combinação de start/end que passe de um dia.
  check(
    "match_days_duracao_check",
    sql`${t.endTime} is null or (${t.startTime} is not null and (case when ${t.endTime} > ${t.startTime} then ${t.endTime} - ${t.startTime} else ${t.endTime} - ${t.startTime} + interval '24 hours' end) between interval '30 minutes' and interval '6 hours')`,
  ),
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
    // Quando saiu o último e-mail de agenda deste par (fut, jogador). É o
    // ledger do freio de src/lib/freios-de-envio.ts, e é uma coluna de domínio
    // pelo mesmo motivo que `invites.email_sent_at` é: o projeto já resolveu
    // "quantas vezes mandei para esta caixa" lendo a linha que registra o envio,
    // sem tabela de contador — que traria GC próprio, uma segunda noção de
    // "quando" e uma chave opaca que nenhum `\d` explica.
    //
    // Envio de FATO, não intenção: uma falha silenciosa não pode custar 10
    // minutos de bloqueio. Best-effort na escrita, como o email_sent_at.
    agendaEmailSentAt: timestamp("agenda_email_sent_at"),
    // QUANTOS e-mails de agenda saíram para este par dentro da janela que
    // termina no carimbo acima. O carimbo sozinho não servia de ledger: ele é
    // sobrescrito, então dez envios e um envio deixam a linha idêntica. Como os
    // tetos somavam LINHAS carimbadas, alternar "Vou"/"Fora" no mesmo fut —
    // cujo cancelamento é isento da janela por par, de propósito — mandava um
    // e-mail por ciclo para sempre com os dois contadores presos em 1. É o
    // vetor que ./freios-de-envio descreve no topo, e ele sobrevivia ao próprio
    // freio.
    //
    // Zerado (e não incrementado) quando o carimbo anterior já saiu da janela
    // de 24h — ver `carimbarEnvio`. Assim a coluna não precisa de GC: ela se
    // recicla no próximo envio, e fora da janela ninguém a lê.
    agendaEmailsSent: integer("agenda_emails_sent").notNull().default(0),
    // Quem pôs esta pessoa na lista. Nulo = ela mesma — o valor de todo o
    // histórico, e o que `entrarNaLista` volta a gravar sempre que a própria
    // pessoa entra.
    //
    // Existe pelos mesmos dois motivos de `players.created_by_player_id`. O
    // primeiro é que sem esta coluna auto-confirmação e confirmação por terceiro
    // produzem linhas IDÊNTICAS, e a única testemunha do que aconteceu era uma
    // linha em `notifications` — outra tabela, com chave opaca, que a pessoa
    // apaga ao marcar como lida. O segundo é o e-mail: o convite de agenda muda
    // de texto quando a presença foi marcada por outro (ver
    // src/lib/agenda-convite.ts), e é daqui que sai o nome de quem marcou.
    //
    // `set null`, NUNCA `cascade`: apagar quem confirmou não pode apagar a
    // presença de quem foi confirmado — a linha carrega V/E/D e avaliação.
    confirmedByPlayerId: integer("confirmed_by_player_id").references(() => players.id, {
      onDelete: "set null",
    }),
    // Quando a PRÓPRIA pessoa tirou o nome desta lista. É o que desambigua o
    // `out`, que colapsa três histórias diferentes: "desisti", "nunca respondi"
    // e "o organizador me tirou". Só a primeira carimba aqui.
    //
    // É o registro do consentimento retirado, e por isso ele vale contra todo
    // mundo — inclusive contra o admin da plataforma, que passa por cima de
    // qualquer outra regra de fut (ver podeDefinirPresencaPor em
    // src/lib/permissions.ts). Sem ele, `jaEstaNoFut` devolvia `true` para quem
    // tinha linha `out` e o organizador repunha na lista quem acabara de sair,
    // quantas vezes quisesse.
    //
    // Limpo quando a pessoa entra por conta própria: o desfazer é dela também.
    // Junto com ele, `entrarNaLista` fecha a OUTRA fonte de recusa (o convite
    // `declined`) — meia limpeza deixava a pessoa `in` e recusada ao mesmo
    // tempo, sem caminho de volta nenhum.
    //
    // Só carimba quem tinha linha para sair: "Fora" num fut em que nunca se
    // esteve não é consentimento retirado, e trancaria o organizador contra
    // alguém que nunca esteve na lista dele.
    optedOutAt: timestamp("opted_out_at"),
    // Quando saiu o e-mail de resumo deste fut para esta pessoa. Ledger do
    // encerramento (ver src/lib/email-resumo.ts), e o `is null` dele É a
    // idempotência do envio: só recebe quem ainda não recebeu.
    //
    // Timestamp sozinho, sem a coluna-contador irmã que a agenda precisou ter.
    // A diferença é que a agenda REENVIA no mesmo par (atualização,
    // cancelamento), e um carimbo sobrescrito fazia dez envios contarem 1; o
    // resumo sai UMA vez por par (fut, jogador), para sempre — o fut encerra
    // uma vez só e não existe "reabrir". Aqui uma linha carimbada é um e-mail,
    // e um contador só assumiria 0 e 1.
    //
    // Envio de FATO, como os irmãos: carimba depois do 200 do Resend, e
    // best-effort na escrita — falhar aqui custa um e-mail repetido, não um
    // e-mail perdido.
    resumoEmailSentAt: timestamp("resumo_email_sent_at"),
  },
  (t) => [
    unique().on(t.matchDayId, t.playerId),
    // O teto por caixa de entrada pergunta "quantos este jogador recebeu nas
    // últimas 24h". Parcial porque só linha carimbada interessa, e a esmagadora
    // maioria das presenças nunca gerou e-mail — mesmo molde do
    // notifications_push_pendentes_idx.
    index("attendances_agenda_envio_idx")
      .on(t.playerId, t.agendaEmailSentAt)
      .where(sql`agenda_email_sent_at is not null`),
    // O vínculo do fut avulso ("já dividiu um fut com") pergunta por player_id
    // sozinho — `condicaoJaJogouCom` e `jaJogaramJuntos`, em src/lib/elegiveis.ts
    // e src/lib/fut-entrada-db.ts. A unique acima começa por match_day_id e não
    // atende essa forma, e estas consultas rodam em toda renderização de
    // /fut/[id], em todo setMyAttendance("in") e na varredura de véspera.
    index("attendances_jogador_idx").on(t.playerId),
    // O teto diário da instalação soma o resumo junto com os outros fluxos (ver
    // src/lib/contagem-de-envios.ts). Parcial pelo mesmo motivo do índice de
    // agenda logo acima: só linha carimbada interessa.
    index("attendances_resumo_envio_idx")
      .on(t.playerId, t.resumoEmailSentAt)
      .where(sql`resumo_email_sent_at is not null`),
  ],
);

export const matchDayInvitationStatusEnum = pgEnum("match_day_invitation_status", [
  "pending",
  "accepted",
  "declined",
  "revoked",
]);

export const matchDayJoinRequestStatusEnum = pgEnum("match_day_join_request_status", [
  "pending",
  "approved",
  "rejected",
]);

// ---------------------------------------------------------------------------
// Entrar num fut sem ser posto nele
//
// As três tabelas abaixo são o espelho literal do que os grupos já têm
// (group_invitations, group_join_requests, group_invite_links), e existem pelo
// mesmo motivo que aquelas: **ninguém entra numa lista por decisão de outra
// pessoa**.
//
// O que elas substituem era uma exceção em `podeDefinirPresencaPor` que, em fut
// avulso, deixava quem criasse o fut marcar presença de qualquer jogador ativo
// da plataforma — e cada marcação dispara notificação, push e um e-mail de
// calendário com texto livre do organizador para a caixa da pessoa. A exceção
// continua existindo para quem NÃO tem conta (o convidado que chegou na hora e
// não consegue se marcar), que é o caso para o qual ela foi escrita.
//
// Os três caminhos de entrada, do enunciado do produto:
//
// - **convite** — quem já jogou com você chama; quem decide é você;
// - **pedido** — você encontra o fut na aba de explorar e pede; quem decide é
//   quem organiza;
// - **link** — quem organiza manda o link; quem abre entra.
//
// Convite e pedido são a mesma forma com decisores OPOSTOS, e por isso são duas
// tabelas e não uma com discriminador — a mesma decisão (e o mesmo comentário)
// de group_invitations. Um `where` que esquecesse o discriminador viraria
// escalada: aprovar o próprio pedido pela rota de "aceitar convite".

export const matchDayInvitations = pgTable(
  "match_day_invitations",
  {
    id: serial("id").primaryKey(),
    matchDayId: integer("match_day_id")
      .notNull()
      .references(() => matchDays.id, { onDelete: "cascade" }),
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    invitedByPlayerId: integer("invited_by_player_id").references(() => players.id, {
      onDelete: "set null",
    }),
    status: matchDayInvitationStatusEnum("status").notNull().default("pending"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    respondedAt: timestamp("responded_at"),
  },
  (t) => [
    // Um pendente por pessoa por fut. Parcial, como o de grupo: quem recusou
    // pode ser chamado de novo no fut seguinte, e a recusa fica no histórico.
    uniqueIndex("match_day_invitations_pendente_idx")
      .on(t.matchDayId, t.playerId)
      .where(sql`status = 'pending'`),
    index("match_day_invitations_convidado_idx").on(t.playerId, t.status),
  ],
);

export const matchDayJoinRequests = pgTable(
  "match_day_join_requests",
  {
    id: serial("id").primaryKey(),
    matchDayId: integer("match_day_id")
      .notNull()
      .references(() => matchDays.id, { onDelete: "cascade" }),
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    status: matchDayJoinRequestStatusEnum("status").notNull().default("pending"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    decidedAt: timestamp("decided_at"),
    decidedByPlayerId: integer("decided_by_player_id").references(() => players.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    uniqueIndex("match_day_join_requests_pendente_idx")
      .on(t.matchDayId, t.playerId)
      .where(sql`status = 'pending'`),
    index("match_day_join_requests_fila_idx").on(t.matchDayId, t.status),
  ],
);

export const matchDayInviteLinks = pgTable(
  "match_day_invite_links",
  {
    id: serial("id").primaryKey(),
    matchDayId: integer("match_day_id")
      .notNull()
      .references(() => matchDays.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(), // 32 bytes aleatórios em base64url
    createdByPlayerId: integer("created_by_player_id").references(() => players.id, {
      onDelete: "set null",
    }),
    // Multi-uso pelo mesmo motivo do link de grupo: link que morre no primeiro
    // clique é inútil num grupo de WhatsApp. Nulo = sem teto.
    maxUses: integer("max_uses"),
    usesCount: integer("uses_count").notNull().default(0),
    expiresAt: timestamp("expires_at").notNull(),
    revokedAt: timestamp("revoked_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("match_day_invite_links_fut_idx").on(t.matchDayId, t.revokedAt)],
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
//
// A súmula ao vivo move esta linha com o jogo em andamento (`trocarDeLado`), e
// aí o lado gravado passa a ser aquele em que a pessoa TERMINOU o jogo — que é
// o que o V/E/D e a avaliação querem dizer. O gol continua com o lado do
// momento em que saiu, gravado em `goals.side`: os dois divergem de propósito
// depois de uma troca (ver `coleteDoGol` em src/lib/resumo.ts).
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

// Troca de lado no meio de um jogo da súmula ao vivo — alguém sai de um colete e
// entra no outro sem o jogo parar (lesão, time desfalcado, chegou gente).
//
// É LOG, não estado. O estado mora em dois lugares que a `trocarDeLado` escreve
// no mesmo commit: `game_players.side`, que passa a dizer o lado em que a pessoa
// TERMINOU o jogo (e por isso o V/E/D e os companheiros de avaliação seguem a
// troca sozinhos), e `team_players`, o colete do fut, para o jogo seguinte
// nascer com ela no time novo. Esta tabela existe para a auditoria visível do
// painel — quem moveu quem, de onde para onde e quando —, no mesmo espírito do
// soft-delete de `goals`: todo operador vê o que todo operador fez.
//
// Sem "desfazer": voltar é trocar de novo, e as duas linhas ficam. O histórico
// de um jogo confuso é justamente o que se quer ler depois.
//
// Sem `match_day_id` (deriva de `games`) e sem unique — a mesma pessoa pode
// trocar quantas vezes o jogo pedir.
export const trocasDeLado = pgTable(
  "trocas_de_lado",
  {
    id: serial("id").primaryKey(),
    gameId: integer("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    deLado: gameSideEnum("de_lado").notNull(),
    paraLado: gameSideEnum("para_lado").notNull(),
    // Quem operou a súmula na hora. `set null` — apagar o operador não apaga a
    // troca de quem jogou.
    createdByPlayerId: integer("created_by_player_id").references(() => players.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    // A linha do tempo do painel lê as trocas do jogo aberto, por jogo.
    index("trocas_de_lado_game_idx").on(t.gameId),
    // De um lado para o OUTRO: uma linha que não move ninguém seria auditoria
    // mentindo sobre um evento que não houve.
    check("trocas_de_lado_lados_distintos", sql`${t.deLado} <> ${t.paraLado}`),
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
  // A entrada no fut, no mesmo molde dos três de grupo acima e pelo mesmo
  // motivo: a caixa de entrada precisa distinguir "te chamaram para um fut"
  // (que espera resposta sua) de "pediram para entrar no seu fut" (que espera
  // decisão sua).
  "fut_convite",
  "fut_pedido",
  "fut_pedido_resolvido",
  // O encerramento, empacotado: um aviso só por pessoa, no lugar dos dois que
  // competiriam pela mesma atenção (o placar saiu / avalie a rapaziada). São
  // dois valores, e não um, pela mesma razão dos `deletion_vote_*` e dos de
  // grupo — "encerraram o fut que VOCÊ jogou" (que traz placar por e-mail e
  // pode pedir sua avaliação) não é o mesmo evento que "encerraram um fut do
  // seu grupo", e `type` é a única classificação da caixa de entrada legível
  // por máquina.
  //
  // `rating_round_open` continua no enum, mas não é mais emitido: quem abre a
  // rodada parou de notificar e o aviso passou a sair daqui, com o resumo
  // junto. Fica declarado porque há linhas gravadas em produção, e Postgres não
  // remove valor de enum.
  "fut_encerrado",
  "fut_encerrado_no_grupo",
  // A zenha creditada por um fut, num aviso só. O crédito não sai no
  // encerramento — sai na liquidação, um a dois dias depois, quando placar e
  // notas param de mudar (ver src/lib/zenha-engine.ts) —, então ele não tinha
  // como pegar carona no `fut_encerrado`, que já foi embora.
  //
  // O consumo do multiplicador NÃO tem tipo próprio: vai no corpo deste
  // mesmo aviso. Já a devolução tem, porque contraria a expectativa de quem
  // armou e não tem irmão em que pegar carona.
  "zenha_creditada",
  "multiplicador_devolvido",
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
    // A nota desta rodada andou multiplicada.
    //
    // O multiplicador é a única coisa no sistema que faz a nota — o número que
    // diz o que os companheiros acharam de você — se mover mais rápido por
    // dinheiro. Deixar isso sem marca seria pior que a própria regra: quando
    // alguém notasse, a DESCOBERTA é que viraria o problema. Com a coluna, o
    // histórico mostra o selo e a coisa vira parte da graça.
    //
    // Como todo o resto de skill_history, é projeção do replay: reescrita
    // inteira a cada recálculo, a partir do fato durável em
    // `zenha_multiplicadores`.
    multiplicado: boolean("multiplicado").notNull().default(false),
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

// ---------------------------------------------------------------------------
// A zenha: a moeda do FutZenha.
//
// Ganha-se por participar do fut, por ver a nota subir, por ser eleito o melhor
// em campo e por não faltar; gasta-se na loja. Quatro decisões moldam tudo o
// que está abaixo:
//
// 1. O ledger é APPEND-ONLY e nunca é recalculado. A nota é o oposto — ela é
//    replay completo desde 5,0 a cada denúncia aceita (ver src/lib/skill.ts) —,
//    mas dinheiro já pode ter virado item, e não existe replay de um gasto. Por
//    isso o crédito só sai quando o fut amadurece: placar travado, prazo de
//    contestação vencido, nenhuma denúncia aberta. Sem estorno, sem
//    complemento, sem ratchet.
// 2. O saldo é MATERIALIZADO em `zenha_carteiras`, e não derivado de
//    `sum(amount)`. Duas coisas que a soma não dá: uma linha para o UPDATE
//    condicional travar (é ele que serializa a compra concorrente, sem lock
//    nenhum) e o `check (saldo >= 0)`, que é a garantia de banco de que
//    nenhum caminho gasta o que não existe.
// 3. Os VALORES não moram aqui nem no código: moram em `zenha_config`, que
//    guarda só as sobrescritas do admin. Chave ausente vale o padrão de
//    src/lib/zenha.ts. Mudar um valor vale dali para frente — o que já foi
//    pago está no ledger e ninguém recalcula.
// 4. O catálogo da loja é DADO (`loja_itens`), e não código. Já foi o
//    contrário, com o argumento de que cada item precisa de arte própria e
//    migration nenhuma carrega arte. O que virou a mesa foi a arte deixar de
//    ser código: o badge é uma IMAGEM que o admin envia (`loja_imagens`), e um
//    produto cuja identidade é um upload não tem como nascer de um `git push`.
//    Daí `zenha_inventario.item_id` ser integer com FK de verdade — e
//    `restrict`, para item vendido não poder ser apagado por baixo de quem
//    pagou.
// ---------------------------------------------------------------------------

// Por que a zenha entrou na carteira. É o que o extrato lê para escrever a
// linha e o que a chave de deduplicação prefixa.
export const zenhaMotivoEnum = pgEnum("zenha_motivo", [
  // Foi ao fut e cumpriu o ritual da avaliação — o pacote que o produto trata
  // como uma coisa só.
  "participacao",
  // A nota subiu no fechamento da rodada (ou se manteve em 10,0, que é o único
  // lugar de onde não há para onde subir).
  "nota",
  "mvp",
  // Fechou a sequência de presenças seguidas no grupo.
  "streak",
  // O saldo de estreia, igual para todo mundo.
  "boas_vindas",
  // A única linha negativa do ledger. Não existe motivo de estorno: quando um
  // multiplicador não vale, o que volta é o ITEM, nunca o dinheiro.
  "compra",
]);

// O que um item da loja É — e, por consequência, o que a tela precisa desenhar
// dele.
//
// `badge` tem imagem enviada pelo admin e é a única vitrine com mais de uma
// vaga; `moldura` e `cor_do_nome` são uma COR e nada mais (o desenho é o anel do
// avatar e o nome do jogador, que já existem); `titulo` é o próprio nome do
// produto virando capsula; `consumivel` é o único que faz alguma coisa em campo,
// e o único que o admin não cria — o efeito dele é código (ver `efeito`).
export const lojaTipoEnum = pgEnum("loja_tipo", [
  "badge",
  "moldura",
  "cor_do_nome",
  "titulo",
  "consumivel",
]);

// Onde um item comprado aparece, quando o lugar é ÚNICO. Um por vez em cada
// lugar — quem garante isso é a PK composta de `zenha_equipados`, não a
// aplicação.
//
// `badge` não está aqui de propósito, e já esteve: badge virou coleção (até
// cinco na `zenha_vitrine`, um em destaque), e slot é justamente a promessa de
// que só cabe um. Deixá-lo no enum seria oferecer duas portas para o mesmo item,
// e a segunda limitaria a vitrine a uma vaga sem dizer isso em lugar nenhum.
export const zenhaSlotEnum = pgEnum("zenha_slot", ["moldura", "cor_do_nome", "titulo"]);

/**
 * Bytes crus, para a imagem do badge.
 *
 * `customType` porque o drizzle-orm desta versão não exporta `bytea`. Do lado do
 * driver não há o que configurar: o postgres.js infere oid 17 de um `Buffer`,
 * serializa em hex e devolve `Buffer` na leitura — com `prepare: false` e
 * `fetch_types: false` do src/db/index.ts inclusive, porque os parsers de tipo
 * embutido são estáticos.
 */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

/**
 * O catálogo da loja.
 *
 * Isto já foi um array em TypeScript, e a troca é o coração desta parte do
 * sistema: enquanto o item era uma capsula de texto colorida, escrever a lista
 * no código pagava — cada entrada tinha piada própria e nasceria de um commit de
 * qualquer jeito. Agora o badge é a IMAGEM que o jogador ostenta (o escudo do
 * time, a foto que o grupo vai reconhecer), e quem escolhe essa imagem é o admin
 * numa tela, não o programador num deploy.
 *
 * Os checks amarram tipo e campos porque a alternativa é validar em três lugares
 * (formulário, action, módulo) e descobrir o quarto tarde demais: cor existe
 * exatamente para moldura e cor do nome, imagem exatamente para badge, efeito
 * exatamente para o consumível. E `efeito` é único parcial: o multiplicador é UM
 * — o motor dele (src/lib/multiplicador-engine.ts) fala em "o consumível", no
 * singular, e duas linhas com o mesmo efeito partiriam essa premissa em silêncio.
 *
 * Não existe apagar item vendido: a FK de `zenha_inventario` é `restrict`, e
 * tirar de venda é `ativo = false`. Item que sai da vitrine continua no perfil
 * de quem pagou por ele — foi o que ele comprou.
 */
export const lojaItens = pgTable(
  "loja_itens",
  {
    id: serial("id").primaryKey(),
    tipo: lojaTipoEnum("tipo").notNull(),
    nome: text("nome").notNull(),
    descricao: text("descricao").notNull().default(""),
    preco: integer("preco").notNull(),
    /** `#rrggbb`. Só moldura e cor do nome. */
    cor: text("cor"),
    /**
     * O hash do conteúdo da imagem — o mesmo de `loja_imagens.hash`. Só badge.
     *
     * Duplicado aqui de propósito: ele entra na URL pública da imagem, e a
     * vitrine, o perfil e cada linha de ranking precisam montar essa URL. Ler o
     * hash da tabela dos BYTES para isso arrastaria o blob inteiro para dentro
     * de uma consulta que só quer desenhar um `<img>`.
     */
    imagemHash: text("imagem_hash"),
    /**
     * O que este item faz em campo. Só o consumível tem.
     *
     * Text com check em vez de enum: existe um valor só, e o dono da regra é o
     * código que implementa o efeito. Um enum prometeria que acrescentar valor é
     * barato — e não é: efeito novo é motor novo, não linha de migration.
     */
    efeito: text("efeito"),
    /** À venda. `false` = saiu da vitrine e continua no perfil de quem tem. */
    ativo: boolean("ativo").notNull().default(true),
    criadoEm: timestamp("criado_em").notNull().defaultNow(),
    atualizadoEm: timestamp("atualizado_em").notNull().defaultNow(),
  },
  (t) => [
    // O teto é alto de propósito: não é regra de produto, é o freio contra dedo
    // escorregado no formulário (um zero a mais tira o item de circulação sem
    // ninguém perceber).
    check("loja_itens_preco_valido", sql`${t.preco} >= 0 and ${t.preco} <= 100000`),
    check("loja_itens_cor_valida", sql`${t.cor} is null or ${t.cor} ~ '^#[0-9a-f]{6}$'`),
    check(
      "loja_itens_cor_por_tipo",
      sql`(${t.tipo} in ('moldura', 'cor_do_nome')) = (${t.cor} is not null)`,
    ),
    check("loja_itens_imagem_por_tipo", sql`(${t.tipo} = 'badge') = (${t.imagemHash} is not null)`),
    check("loja_itens_efeito_por_tipo", sql`(${t.tipo} = 'consumivel') = (${t.efeito} is not null)`),
    check("loja_itens_efeito_conhecido", sql`${t.efeito} is null or ${t.efeito} in ('multiplicador')`),
    uniqueIndex("loja_itens_efeito_unico_idx").on(t.efeito).where(sql`${t.efeito} is not null`),
    // A vitrine é sempre "os ativos, por prateleira e por preço".
    index("loja_itens_vitrine_idx").on(t.ativo, t.tipo, t.preco),
  ],
);

/**
 * Os bytes da imagem do badge.
 *
 * Tabela separada, e não uma coluna em `loja_itens`, porque a leitura quente da
 * loja é a que NÃO quer os bytes: a vitrine, o perfil e cada linha de ranking
 * precisam de nome, preço e hash. Com o blob na mesma linha, um `select` distraído
 * (ou um `select()` sem projeção) carregaria duzentos kilobytes por item para
 * desenhar uma grade — e o Postgres esconde tão bem esse custo no TOAST que
 * ninguém perceberia até a conta do Neon.
 *
 * No Postgres e não num serviço de blob: são poucas imagens, pequenas por
 * construção (o formulário recorta para 256×256 e o servidor recusa acima de
 * 200 KB), e a alternativa custa uma dependência, uma env var, uma linha na CSP
 * e um mock nos testes. Este projeto é de R$ 0 por decisão.
 *
 * `hash` é o conteúdo, e é ele que vai na URL pública: trocar a imagem troca a
 * URL, e é isso que deixa a resposta ser `immutable` por um ano sem risco de
 * alguém ficar preso na arte antiga.
 */
export const lojaImagens = pgTable(
  "loja_imagens",
  {
    itemId: integer("item_id")
      .primaryKey()
      .references(() => lojaItens.id, { onDelete: "cascade" }),
    hash: text("hash").notNull(),
    mime: text("mime").notNull(),
    bytes: bytea("bytes").notNull(),
    atualizadoEm: timestamp("atualizado_em").notNull().defaultNow(),
  },
  (t) => [
    // O mime é servido de volta no `Content-Type`. A lista fechada aqui é a
    // segunda metade da checagem de magic bytes de src/lib/imagem-de-item.ts:
    // nenhum caminho grava svg (que é script) nem gif.
    check("loja_imagens_mime_aceito", sql`${t.mime} in ('image/png', 'image/jpeg', 'image/webp')`),
  ],
);

/**
 * As sobrescritas do admin sobre os valores da economia.
 *
 * Guarda SÓ o que foi mudado: chave ausente vale o padrão declarado em
 * src/lib/zenha.ts (os ganhos e o fator do multiplicador). Uma tabela que
 * espelhasse todos os valores nasceria desatualizada no dia do deploy.
 *
 * Preço de item NÃO mora aqui, e já morou (numa chave `preco:{itemId}`). Ele é
 * coluna de `loja_itens`: com o catálogo em código não havia onde guardá-lo, e
 * a sobrescrita era o contorno; com o catálogo no banco, manter as duas portas
 * seria ter dois donos para o mesmo número — e a de baixo venceria em silêncio.
 *
 * `valor` é integer porque toda grandeza da economia é inteira: zenha não tem
 * centavo, e o fator do multiplicador entra como percentual (150 = 1,5×) em vez
 * de fração, justamente para não abrir a porta do ponto flutuante no meio do
 * cálculo da nota.
 *
 * Mudar um valor aqui vale DALI PARA FRENTE. Nada é recalculado — o que já foi
 * pago está no ledger, o preço pago está no inventário e o fator do
 * multiplicador é congelado na compra. É o append-only que dá essa garantia de
 * graça; não existe código de reprocessamento a escrever.
 */
export const zenhaConfig = pgTable("zenha_config", {
  chave: text("chave").primaryKey(),
  valor: integer("valor").notNull(),
  atualizadoEm: timestamp("atualizado_em").notNull().defaultNow(),
  // Quem mexeu. `set null` porque apagar o admin não pode apagar o ajuste que
  // está valendo para todo mundo.
  atualizadoPorPlayerId: integer("atualizado_por_player_id").references(() => players.id, {
    onDelete: "set null",
  }),
});

/**
 * O saldo de cada jogador.
 *
 * Materializado, e não `sum(zenha_ledger.amount)`, por duas coisas que a soma
 * não dá:
 *
 * 1. **Uma linha para travar.** O débito é
 *    `UPDATE ... SET saldo = saldo - $2 WHERE player_id = $1 AND saldo >= $2
 *    RETURNING` — zero linhas devolvidas é compra recusada. É o mesmo idioma do
 *    `UPDATE ... WHERE status = 'open' RETURNING` de fecharRodada, e é o que faz
 *    duas compras simultâneas se serializarem **sem advisory lock e sem
 *    FOR UPDATE**. Com saldo derivado não haveria o que travar: as duas
 *    transações leriam a mesma soma e as duas passariam.
 * 2. **O `check (saldo >= 0)`.** A garantia de que nenhum caminho — action
 *    nova, script na mão, bug de arredondamento — gasta o que não existe.
 *
 * O preço é a duplicação, e o teste de integração cobra o fecho: ao fim de cada
 * cenário, `saldo` tem que bater com `sum(amount)` do ledger daquele jogador.
 */
export const zenhaCarteiras = pgTable(
  "zenha_carteiras",
  {
    playerId: integer("player_id")
      .primaryKey()
      .references(() => players.id, { onDelete: "cascade" }),
    saldo: integer("saldo").notNull().default(0),
    atualizadoEm: timestamp("atualizado_em").notNull().defaultNow(),
  },
  (t) => [check("zenha_carteiras_saldo_nao_negativo", sql`${t.saldo} >= 0`)],
);

/**
 * O extrato: uma linha por movimento, para sempre.
 *
 * **Append-only.** Nada aqui é reescrito, revisado ou estornado — e é essa
 * promessa que sustenta o resto do desenho. A nota faz o oposto (replay
 * completo desde 5,0 a cada denúncia aceita, ver src/lib/skill.ts), mas a nota
 * é um número; zenha vira badge, e não existe replay de um gasto. Por isso o
 * crédito espera o fut amadurecer — placar travado, prazo de contestação
 * vencido, nenhuma denúncia aberta — e sai UMA vez, já sobre fato congelado.
 *
 * `unique(player_id, dedupe_key)` é a idempotência: o varredor pode passar duas
 * vezes pelo mesmo fut que o segundo insert não faz nada. As chaves são
 * `{motivo}:fut:{matchDayId}` para o automático e `compra:{inventarioId}` para a
 * loja. (`boas-vindas` sobrevive só como saldo de fixture do seed: no app
 * ninguém ganha zenha por existir.)
 *
 * A chave da compra usa o id da linha do INVENTÁRIO, e não o do item: o
 * multiplicador é comprável várias vezes, e `compra:{itemId}` daria o segundo
 * de graça. Um timestamp na chave resolveria isso e quebraria a idempotência do
 * retry, que é o que ela existe para dar.
 *
 * As três FKs são `set null`, NUNCA cascade: apagar um fut não pode evaporar
 * dinheiro que já virou item. É também por isso que `descricao` é congelada na
 * gravação em vez de montada por join na leitura — quando o fut morre, o texto
 * do extrato continua fazendo sentido.
 */
export const zenhaLedger = pgTable(
  "zenha_ledger",
  {
    id: serial("id").primaryKey(),
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    motivo: zenhaMotivoEnum("motivo").notNull(),
    // Positivo credita, negativo debita. Zero nunca: linha que não move saldo é
    // ruído no extrato de quem abriu para entender de onde veio a zenha.
    amount: integer("amount").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    roundId: integer("round_id").references(() => ratingRounds.id, { onDelete: "set null" }),
    matchDayId: integer("match_day_id").references(() => matchDays.id, { onDelete: "set null" }),
    inventarioId: integer("inventario_id").references((): AnyPgColumn => zenhaInventario.id, {
      onDelete: "set null",
    }),
    descricao: text("descricao").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique("zenha_ledger_dedupe_unq").on(t.playerId, t.dedupeKey),
    // O extrato é sempre "as últimas linhas deste jogador". Sem `desc` na
    // definição de propósito: o Postgres varre índice de trás para frente sem
    // custo, e a forma simples é a que sobrevive a upgrade do drizzle.
    index("zenha_ledger_extrato_idx").on(t.playerId, t.createdAt),
    check("zenha_ledger_amount_nao_zero", sql`${t.amount} <> 0`),
  ],
);

/**
 * O que cada um comprou.
 *
 * `item_id` é integer com FK **`restrict`**, e isso é a regra do catálogo virando
 * garantia de banco: enquanto existir uma linha aqui, aquele item não pode ser
 * apagado. Antes o catálogo era código e a coluna era text sem FK; a regra "nunca
 * apagar entrada, só aposentar" existia num comentário, e a punição por quebrá-la
 * era o perfil de alguém apontando para o vazio. Agora quem administra a loja é
 * uma tela — e uma tela precisa que o "não pode" seja verdade, não etiqueta.
 * Retirar de venda continua sendo `loja_itens.ativo = false`.
 *
 * `preco_pago` e `fator_percent` são congelados na compra. O admin pode mexer
 * nos valores amanhã; o que a pessoa comprou continua valendo o que valia.
 *
 * As duas uniques parciais são as duas regras do produto garantidas pelo banco:
 * cosmético não se compra duas vezes, e não se arma dois multiplicadores no
 * mesmo fut.
 */
export const zenhaInventario = pgTable(
  "zenha_inventario",
  {
    id: serial("id").primaryKey(),
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    itemId: integer("item_id")
      .notNull()
      .references(() => lojaItens.id, { onDelete: "restrict" }),
    precoPago: integer("preco_pago").notNull(),
    // Consumível some ao ser usado (o multiplicador); o resto fica para sempre.
    consumivel: boolean("consumivel").notNull().default(false),
    // Só para o multiplicador: o percentual vigente no dia da compra (150 =
    // 1,5×). Nulo nos cosméticos.
    fatorPercent: integer("fator_percent"),
    adquiridoEm: timestamp("adquirido_em").notNull().defaultNow(),
    // Quando o consumível foi GASTO. Nulo = ainda disponível.
    //
    // A linha não é apagada, e não pode ser: `zenha_multiplicadores.inventario_id`
    // aponta para cá com `cascade`, e apagar aqui evaporaria o fato que o replay
    // da nota consome. A marca é o que separa "usado" de "livre" sem quebrar
    // essa cadeia — e de quebra deixa o inventário contar a história ("este você
    // gastou no fut de 12/08").
    //
    // Sem ela, limpar só as colunas do arme no encerramento devolveria o item à
    // prateleira depois de consumido: uma compra viraria multiplicador infinito.
    consumidoEm: timestamp("consumido_em", { withTimezone: true }),
    // O arme: em qual fut este consumível vale, quando foi armado, e até quando
    // valeria armar. `corte_previsto` é congelado no arme para que adiar o fut
    // depois não abra janela nenhuma — ver src/lib/multiplicador-engine.ts.
    armadoMatchDayId: integer("armado_match_day_id").references(() => matchDays.id, {
      onDelete: "set null",
    }),
    armadoEm: timestamp("armado_em", { withTimezone: true }),
    cortePrevisto: timestamp("corte_previsto", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("zenha_inventario_unico_idx")
      .on(t.playerId, t.itemId)
      .where(sql`${t.consumivel} = false`),
    uniqueIndex("zenha_inventario_arme_unico_idx")
      .on(t.playerId, t.armadoMatchDayId)
      .where(sql`${t.armadoMatchDayId} is not null`),
    index("zenha_inventario_jogador_idx").on(t.playerId),
  ],
);

/**
 * O que está aparecendo no perfil nos lugares de vaga ÚNICA: a moldura do
 * avatar, a cor do nome e o título. Badge não passa por aqui — ele é coleção, e
 * mora em `zenha_vitrine`.
 *
 * A PK composta `(player_id, slot)` é o "um por slot" garantido pelo BANCO, no
 * mesmo espírito do group_members_admin_unico_idx: equipar é
 * `onConflictDoUpdate` na PK, e não "apaga o antigo, insere o novo" — que teria
 * uma janela entre as duas escritas.
 *
 * `inventario_id` é unique para o mesmo item não ocupar dois slots.
 */
export const zenhaEquipados = pgTable(
  "zenha_equipados",
  {
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    slot: zenhaSlotEnum("slot").notNull(),
    inventarioId: integer("inventario_id")
      .notNull()
      .unique()
      .references(() => zenhaInventario.id, { onDelete: "cascade" }),
    equipadoEm: timestamp("equipado_em").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.playerId, t.slot] })],
);

/**
 * Os badges que o jogador escolheu ostentar, e qual deles anda junto do nome.
 *
 * Tabela própria e não mais um slot: badge é o único item de COLEÇÃO da loja —
 * dá para ter muitos e mostrar cinco. A `posicao` (1..5) é o que faz a vitrine
 * ter ordem escolhida em vez de ordem de compra, e a PK `(player_id, posicao)`
 * é o teto das cinco vagas garantido pelo BANCO: não existe caminho de aplicação
 * que ponha um sexto.
 *
 * `destaque` é o badge que aparece ao lado do nome em ranking, escalação e lista
 * de presença — o único cosmético que sai do perfil e circula pelo app. Uma
 * coluna booleana com **unique parcial**, e não um `destaque_inventario_id` em
 * outra tabela: assim "ser o destaque" é uma propriedade da linha que já está na
 * vitrine, e é impossível destacar o que não está sendo mostrado. O parcial é o
 * que permite muitos `false` e um só `true` por jogador.
 *
 * `inventario_id` é unique (global, não por jogador) pela mesma razão de
 * `zenha_equipados`: o mesmo item comprado não ocupa duas vagas.
 */
export const zenhaVitrine = pgTable(
  "zenha_vitrine",
  {
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    posicao: integer("posicao").notNull(),
    inventarioId: integer("inventario_id")
      .notNull()
      .unique()
      .references(() => zenhaInventario.id, { onDelete: "cascade" }),
    destaque: boolean("destaque").notNull().default(false),
    colocadoEm: timestamp("colocado_em").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.playerId, t.posicao] }),
    check("zenha_vitrine_posicao_valida", sql`${t.posicao} between 1 and 5`),
    uniqueIndex("zenha_vitrine_destaque_unico_idx").on(t.playerId).where(sql`${t.destaque}`),
  ],
);

/**
 * Quem armou multiplicador em qual fut, e com que força.
 *
 * É um FATO DURÁVEL, e é isso que o torna compatível com o replay. A nota é
 * recalculada do zero a cada denúncia aceita e a cada fut apagado (ver
 * src/lib/skill.ts); reproduzir a nota de uma rodada antiga exige reproduzir
 * também o multiplicador que valia nela. Guardar o efeito — "esta nota já veio
 * multiplicada" — não daria: o replay reescreve a nota inteira.
 *
 * `fator_num`/`fator_den` são CONGELADOS aqui a partir do que estava congelado
 * no inventário na hora da compra. Se a loja um dia vender 2×, a rodada de dois
 * meses atrás continua replaiando a 1,5× — para sempre, e sem que ninguém
 * precise lembrar disso.
 *
 * `match_day_id` com **cascade**, e isso não é estilo: `apagarFut`
 * (src/lib/deletion.ts) é hard delete, e um estouro de FK dentro de
 * `processarPendencias` — cujo `.catch` só escreve no log — pararia a varredura
 * INTEIRA em silêncio: rodada nunca mais fecha por prazo, denúncia nunca mais
 * resolve, lembrete nunca mais sai.
 *
 * O cascade some com o FATO, e só com ele — devolver o item é outra escrita.
 * `zenha_inventario.consumido_em` é coluna do inventário e o cascade não a
 * alcança, então quem conta com "o banco desfaz sozinho" prende um item pago num
 * fut que não existe mais. Quem devolve é `soltarMultiplicadoresDoFut`
 * (src/lib/multiplicador-engine.ts), chamada por `apagarFut` ANTES do delete —
 * depois dele não há mais como saber quais itens foram consumidos aqui.
 */
export const zenhaMultiplicadores = pgTable(
  "zenha_multiplicadores",
  {
    matchDayId: integer("match_day_id")
      .notNull()
      .references(() => matchDays.id, { onDelete: "cascade" }),
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    // A linha do inventário que foi consumida. Unique porque um item só se
    // gasta uma vez; cascade porque item apagado não deixa fato órfão.
    inventarioId: integer("inventario_id")
      .notNull()
      .unique()
      .references((): AnyPgColumn => zenhaInventario.id, { onDelete: "cascade" }),
    fatorNum: integer("fator_num").notNull(),
    fatorDen: integer("fator_den").notNull(),
    aplicadoEm: timestamp("aplicado_em").notNull().defaultNow(),
  },
  (t) => [
    // Um por (fut, jogador): o multiplicador NÃO empilha. Quem garante é a PK,
    // não a aplicação — e é por isso que o replay pode ler o fator como um
    // valor, em vez de contar quantas linhas existem.
    primaryKey({ columns: [t.matchDayId, t.playerId] }),
    // Fator sempre maior que 1 e denominador positivo. Um fator neutro gravado
    // aqui seria uma linha que promete movimento e não entrega; um denominador
    // zero seria divisão por zero no meio do cálculo da nota.
    check(
      "zenha_multiplicadores_fator_valido",
      sql`${t.fatorNum} > ${t.fatorDen} and ${t.fatorDen} > 0`,
    ),
    index("zenha_multiplicadores_jogador_idx").on(t.playerId),
  ],
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
export type MatchDayInvitation = typeof matchDayInvitations.$inferSelect;
export type MatchDayJoinRequest = typeof matchDayJoinRequests.$inferSelect;
export type MatchDayInviteLink = typeof matchDayInviteLinks.$inferSelect;
export type Attendance = typeof attendances.$inferSelect;
export type Team = typeof teams.$inferSelect;
export type Game = typeof games.$inferSelect;
export type GamePlayer = typeof gamePlayers.$inferSelect;
export type Goal = typeof goals.$inferSelect;
export type SumulaOperador = typeof sumulaOperadores.$inferSelect;
export type TrocaDeLado = typeof trocasDeLado.$inferSelect;
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
export type LojaItem = typeof lojaItens.$inferSelect;
export type LojaImagem = typeof lojaImagens.$inferSelect;
export type LojaTipo = (typeof lojaTipoEnum.enumValues)[number];
export type ZenhaVitrineLinha = typeof zenhaVitrine.$inferSelect;
export type ZenhaConfig = typeof zenhaConfig.$inferSelect;
export type ZenhaCarteira = typeof zenhaCarteiras.$inferSelect;
export type ZenhaLedgerEntry = typeof zenhaLedger.$inferSelect;
export type ZenhaInventarioItem = typeof zenhaInventario.$inferSelect;
export type ZenhaEquipado = typeof zenhaEquipados.$inferSelect;
export type ZenhaMultiplicador = typeof zenhaMultiplicadores.$inferSelect;
export type ZenhaMotivo = (typeof zenhaMotivoEnum.enumValues)[number];
export type ZenhaSlot = (typeof zenhaSlotEnum.enumValues)[number];
