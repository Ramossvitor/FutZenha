CREATE TYPE "public"."game_side" AS ENUM('A', 'B');--> statement-breakpoint
CREATE TABLE "game_players" (
	"game_id" integer NOT NULL,
	"player_id" integer NOT NULL,
	"side" "game_side" NOT NULL,
	CONSTRAINT "game_players_game_id_player_id_pk" PRIMARY KEY("game_id","player_id")
);
--> statement-breakpoint
ALTER TABLE "game_players" ADD CONSTRAINT "game_players_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_players" ADD CONSTRAINT "game_players_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "game_players_player_idx" ON "game_players" USING btree ("player_id");--> statement-breakpoint
INSERT INTO "game_players" ("game_id", "player_id", "side")
SELECT g."id", tp."player_id", 'A'::"public"."game_side" FROM "games" g
  JOIN "team_players" tp ON tp."team_id" = g."team_a_id"
UNION ALL
SELECT g."id", tp."player_id", 'B'::"public"."game_side" FROM "games" g
  JOIN "team_players" tp ON tp."team_id" = g."team_b_id"
ON CONFLICT DO NOTHING;