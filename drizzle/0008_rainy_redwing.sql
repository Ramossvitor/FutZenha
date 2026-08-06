ALTER TABLE "match_day_deletion_votes" ADD COLUMN "opened_by_player_id" integer;--> statement-breakpoint
ALTER TABLE "match_days" ADD COLUMN "created_by_player_id" integer;--> statement-breakpoint
ALTER TABLE "rating_reports" ADD COLUMN "resolved_by_player_id" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_platform_admin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "match_day_deletion_votes" ADD CONSTRAINT "match_day_deletion_votes_opened_by_player_id_players_id_fk" FOREIGN KEY ("opened_by_player_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_days" ADD CONSTRAINT "match_days_created_by_player_id_players_id_fk" FOREIGN KEY ("created_by_player_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rating_reports" ADD CONSTRAINT "rating_reports_resolved_by_player_id_players_id_fk" FOREIGN KEY ("resolved_by_player_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;