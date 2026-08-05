CREATE TYPE "public"."notification_type" AS ENUM('rating_round_open', 'rating_round_closed', 'skill_changed', 'skill_recalculated', 'rating_report_resolved');--> statement-breakpoint
CREATE TYPE "public"."rating_report_status" AS ENUM('open', 'accepted', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."rating_round_close_reason" AS ENUM('todos_avaliaram', 'prazo', 'admin');--> statement-breakpoint
CREATE TYPE "public"."rating_round_status" AS ENUM('open', 'closed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."report_resolver" AS ENUM('admin', 'auto');--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"player_id" integer NOT NULL,
	"type" "notification_type" NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"href" text,
	"dedupe_key" text NOT NULL,
	"read_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_player_id_dedupe_key_unique" UNIQUE("player_id","dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "rating_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"rating_id" integer NOT NULL,
	"reporter_player_id" integer NOT NULL,
	"reason" text,
	"status" "rating_report_status" DEFAULT 'open' NOT NULL,
	"opened_at" timestamp DEFAULT now() NOT NULL,
	"admin_deadline_at" timestamp NOT NULL,
	"resolved_at" timestamp,
	"resolved_by" "report_resolver",
	"admin_note" text,
	CONSTRAINT "rating_reports_rating_id_unique" UNIQUE("rating_id")
);
--> statement-breakpoint
CREATE TABLE "rating_round_raters" (
	"round_id" integer NOT NULL,
	"player_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"submitted_at" timestamp,
	CONSTRAINT "rating_round_raters_round_id_player_id_pk" PRIMARY KEY("round_id","player_id")
);
--> statement-breakpoint
CREATE TABLE "rating_rounds" (
	"id" serial PRIMARY KEY NOT NULL,
	"match_day_id" integer NOT NULL,
	"status" "rating_round_status" DEFAULT 'open' NOT NULL,
	"opened_at" timestamp DEFAULT now() NOT NULL,
	"deadline_at" timestamp NOT NULL,
	"closed_at" timestamp,
	"report_deadline_at" timestamp,
	"close_reason" "rating_round_close_reason",
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "rating_rounds_match_day_id_unique" UNIQUE("match_day_id")
);
--> statement-breakpoint
CREATE TABLE "ratings" (
	"id" serial PRIMARY KEY NOT NULL,
	"round_id" integer NOT NULL,
	"rater_player_id" integer NOT NULL,
	"rated_player_id" integer NOT NULL,
	"stars" integer NOT NULL,
	"discarded_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ratings_round_id_rater_player_id_rated_player_id_unique" UNIQUE("round_id","rater_player_id","rated_player_id"),
	CONSTRAINT "ratings_stars_check" CHECK ("ratings"."stars" between 1 and 5),
	CONSTRAINT "ratings_no_self_check" CHECK ("ratings"."rater_player_id" <> "ratings"."rated_player_id")
);
--> statement-breakpoint
CREATE TABLE "skill_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"player_id" integer NOT NULL,
	"round_id" integer NOT NULL,
	"skill_before" numeric(3, 1) NOT NULL,
	"skill_after" numeric(3, 1) NOT NULL,
	"ratings_count" integer NOT NULL,
	"average_received" numeric(4, 2) NOT NULL,
	"computed_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "skill_history_player_id_round_id_unique" UNIQUE("player_id","round_id")
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rating_reports" ADD CONSTRAINT "rating_reports_rating_id_ratings_id_fk" FOREIGN KEY ("rating_id") REFERENCES "public"."ratings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rating_reports" ADD CONSTRAINT "rating_reports_reporter_player_id_players_id_fk" FOREIGN KEY ("reporter_player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rating_round_raters" ADD CONSTRAINT "rating_round_raters_round_id_rating_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rating_rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rating_round_raters" ADD CONSTRAINT "rating_round_raters_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rating_round_raters" ADD CONSTRAINT "rating_round_raters_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rating_rounds" ADD CONSTRAINT "rating_rounds_match_day_id_match_days_id_fk" FOREIGN KEY ("match_day_id") REFERENCES "public"."match_days"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_round_id_rating_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rating_rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_rater_player_id_players_id_fk" FOREIGN KEY ("rater_player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_rated_player_id_players_id_fk" FOREIGN KEY ("rated_player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_history" ADD CONSTRAINT "skill_history_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_history" ADD CONSTRAINT "skill_history_round_id_rating_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rating_rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_inbox_idx" ON "notifications" USING btree ("player_id","read_at");--> statement-breakpoint
CREATE INDEX "rating_reports_pendentes_idx" ON "rating_reports" USING btree ("status","admin_deadline_at");--> statement-breakpoint
CREATE INDEX "rating_rounds_pendentes_idx" ON "rating_rounds" USING btree ("status","deadline_at");--> statement-breakpoint
CREATE INDEX "ratings_round_rated_idx" ON "ratings" USING btree ("round_id","rated_player_id");--> statement-breakpoint
CREATE INDEX "ratings_rated_idx" ON "ratings" USING btree ("rated_player_id");