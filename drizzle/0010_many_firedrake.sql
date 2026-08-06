CREATE TYPE "public"."group_invitation_status" AS ENUM('pending', 'accepted', 'declined', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."group_join_policy" AS ENUM('request', 'open');--> statement-breakpoint
CREATE TYPE "public"."group_join_request_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."group_role" AS ENUM('admin', 'organizer', 'member');--> statement-breakpoint
CREATE TYPE "public"."group_visibility" AS ENUM('private', 'public');--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'group_invitation';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'group_join_request';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'group_join_request_resolved';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'group_role_changed';--> statement-breakpoint
CREATE TABLE "group_invitations" (
	"id" serial PRIMARY KEY NOT NULL,
	"group_id" integer NOT NULL,
	"player_id" integer NOT NULL,
	"invited_by_player_id" integer,
	"status" "group_invitation_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"responded_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "group_invite_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"group_id" integer NOT NULL,
	"token" text NOT NULL,
	"created_by_player_id" integer,
	"max_uses" integer,
	"uses_count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp NOT NULL,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "group_invite_links_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "group_join_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"group_id" integer NOT NULL,
	"player_id" integer NOT NULL,
	"status" "group_join_request_status" DEFAULT 'pending' NOT NULL,
	"decided_by_player_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"decided_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "group_members" (
	"group_id" integer NOT NULL,
	"player_id" integer NOT NULL,
	"role" "group_role" DEFAULT 'member' NOT NULL,
	"joined_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "group_members_group_id_player_id_pk" PRIMARY KEY("group_id","player_id")
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"visibility" "group_visibility" DEFAULT 'private' NOT NULL,
	"join_policy" "group_join_policy" DEFAULT 'request' NOT NULL,
	"created_by_player_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "match_days" ADD COLUMN "group_id" integer;--> statement-breakpoint
ALTER TABLE "group_invitations" ADD CONSTRAINT "group_invitations_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_invitations" ADD CONSTRAINT "group_invitations_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_invitations" ADD CONSTRAINT "group_invitations_invited_by_player_id_players_id_fk" FOREIGN KEY ("invited_by_player_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_invite_links" ADD CONSTRAINT "group_invite_links_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_invite_links" ADD CONSTRAINT "group_invite_links_created_by_player_id_players_id_fk" FOREIGN KEY ("created_by_player_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_join_requests" ADD CONSTRAINT "group_join_requests_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_join_requests" ADD CONSTRAINT "group_join_requests_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_join_requests" ADD CONSTRAINT "group_join_requests_decided_by_player_id_players_id_fk" FOREIGN KEY ("decided_by_player_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_created_by_player_id_players_id_fk" FOREIGN KEY ("created_by_player_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "group_invitations_pendente_idx" ON "group_invitations" USING btree ("group_id","player_id") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "group_invitations_convidado_idx" ON "group_invitations" USING btree ("player_id","status");--> statement-breakpoint
CREATE INDEX "group_invite_links_grupo_idx" ON "group_invite_links" USING btree ("group_id","revoked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "group_join_requests_pendente_idx" ON "group_join_requests" USING btree ("group_id","player_id") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "group_join_requests_fila_idx" ON "group_join_requests" USING btree ("group_id","status");--> statement-breakpoint
CREATE INDEX "group_members_player_idx" ON "group_members" USING btree ("player_id");--> statement-breakpoint
CREATE UNIQUE INDEX "group_members_admin_unico_idx" ON "group_members" USING btree ("group_id") WHERE role = 'admin';--> statement-breakpoint
CREATE INDEX "groups_descoberta_idx" ON "groups" USING btree ("visibility","name");--> statement-breakpoint
ALTER TABLE "match_days" ADD CONSTRAINT "match_days_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "match_days_group_idx" ON "match_days" USING btree ("group_id","date");