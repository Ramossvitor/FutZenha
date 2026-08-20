-- Entrar num fut sem ser posto nele: convite, pedido e link.
--
-- Espelho literal do que os grupos ja tem (group_invitations,
-- group_join_requests, group_invite_links). Substitui a excecao que, em fut
-- avulso, deixava quem criasse o fut marcar presenca de QUALQUER jogador ativo
-- da plataforma -- e cada marcacao dispara notificacao, push e um e-mail de
-- calendario com texto livre do organizador para a caixa da pessoa.
--
-- Tres caminhos, tres decisores:
--   convite -> quem ja jogou com voce chama, e QUEM DECIDE E VOCE;
--   pedido  -> voce acha o fut na aba de explorar, e quem decide e quem organiza;
--   link    -> quem organiza manda, quem abre entra.
--
-- Convite e pedido sao duas tabelas e nao uma com discriminador, pela mesma
-- razao das de grupo: um `where` que esquecesse o discriminador viraria
-- escalada -- aprovar o proprio pedido pela rota de "aceitar convite".
--
-- Tudo aditivo. Os tres ALTER TYPE do notification_type entram em statements
-- separados (o drizzle honra os statement-breakpoint) porque o Postgres nao
-- deixa criar e usar valor de enum na mesma transacao -- a licao da 0012.

CREATE TYPE "public"."match_day_invitation_status" AS ENUM('pending', 'accepted', 'declined', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."match_day_join_request_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'fut_convite';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'fut_pedido';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'fut_pedido_resolvido';--> statement-breakpoint
CREATE TABLE "match_day_invitations" (
	"id" serial PRIMARY KEY NOT NULL,
	"match_day_id" integer NOT NULL,
	"player_id" integer NOT NULL,
	"invited_by_player_id" integer,
	"status" "match_day_invitation_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"responded_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "match_day_invite_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"match_day_id" integer NOT NULL,
	"token" text NOT NULL,
	"created_by_player_id" integer,
	"max_uses" integer,
	"uses_count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp NOT NULL,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "match_day_invite_links_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "match_day_join_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"match_day_id" integer NOT NULL,
	"player_id" integer NOT NULL,
	"status" "match_day_join_request_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"decided_at" timestamp,
	"decided_by_player_id" integer
);
--> statement-breakpoint
ALTER TABLE "match_day_invitations" ADD CONSTRAINT "match_day_invitations_match_day_id_match_days_id_fk" FOREIGN KEY ("match_day_id") REFERENCES "public"."match_days"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_day_invitations" ADD CONSTRAINT "match_day_invitations_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_day_invitations" ADD CONSTRAINT "match_day_invitations_invited_by_player_id_players_id_fk" FOREIGN KEY ("invited_by_player_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_day_invite_links" ADD CONSTRAINT "match_day_invite_links_match_day_id_match_days_id_fk" FOREIGN KEY ("match_day_id") REFERENCES "public"."match_days"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_day_invite_links" ADD CONSTRAINT "match_day_invite_links_created_by_player_id_players_id_fk" FOREIGN KEY ("created_by_player_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_day_join_requests" ADD CONSTRAINT "match_day_join_requests_match_day_id_match_days_id_fk" FOREIGN KEY ("match_day_id") REFERENCES "public"."match_days"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_day_join_requests" ADD CONSTRAINT "match_day_join_requests_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_day_join_requests" ADD CONSTRAINT "match_day_join_requests_decided_by_player_id_players_id_fk" FOREIGN KEY ("decided_by_player_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "match_day_invitations_pendente_idx" ON "match_day_invitations" USING btree ("match_day_id","player_id") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "match_day_invitations_convidado_idx" ON "match_day_invitations" USING btree ("player_id","status");--> statement-breakpoint
CREATE INDEX "match_day_invite_links_fut_idx" ON "match_day_invite_links" USING btree ("match_day_id","revoked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "match_day_join_requests_pendente_idx" ON "match_day_join_requests" USING btree ("match_day_id","player_id") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "match_day_join_requests_fila_idx" ON "match_day_join_requests" USING btree ("match_day_id","status");