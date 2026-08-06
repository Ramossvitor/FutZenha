CREATE TYPE "public"."deletion_vote_status" AS ENUM('open', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "match_day_deletion_voters" (
	"vote_id" integer NOT NULL,
	"player_id" integer NOT NULL,
	"in_favor" boolean,
	"voted_at" timestamp,
	CONSTRAINT "match_day_deletion_voters_vote_id_player_id_pk" PRIMARY KEY("vote_id","player_id")
);
--> statement-breakpoint
CREATE TABLE "match_day_deletion_votes" (
	"id" serial PRIMARY KEY NOT NULL,
	"match_day_id" integer NOT NULL,
	"reason" text NOT NULL,
	"status" "deletion_vote_status" DEFAULT 'open' NOT NULL,
	"opened_at" timestamp DEFAULT now() NOT NULL,
	"deadline_at" timestamp NOT NULL,
	"eligible_count" integer NOT NULL,
	"required_yes" integer NOT NULL,
	"resolved_at" timestamp,
	CONSTRAINT "match_day_deletion_votes_match_day_id_unique" UNIQUE("match_day_id")
);
--> statement-breakpoint
ALTER TABLE "match_day_deletion_voters" ADD CONSTRAINT "match_day_deletion_voters_vote_id_match_day_deletion_votes_id_fk" FOREIGN KEY ("vote_id") REFERENCES "public"."match_day_deletion_votes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_day_deletion_voters" ADD CONSTRAINT "match_day_deletion_voters_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_day_deletion_votes" ADD CONSTRAINT "match_day_deletion_votes_match_day_id_match_days_id_fk" FOREIGN KEY ("match_day_id") REFERENCES "public"."match_days"("id") ON DELETE cascade ON UPDATE no action;