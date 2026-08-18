CREATE TABLE "sumula_operadores" (
	"match_day_id" integer NOT NULL,
	"player_id" integer NOT NULL,
	"created_by_player_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sumula_operadores_match_day_id_player_id_pk" PRIMARY KEY("match_day_id","player_id")
);
--> statement-breakpoint
ALTER TABLE "goals" ALTER COLUMN "player_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "started_at" timestamp;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "finished_at" timestamp;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "side" "game_side";--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "created_by_player_id" integer;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "created_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "desfeito_em" timestamp;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "desfeito_por_player_id" integer;--> statement-breakpoint
ALTER TABLE "sumula_operadores" ADD CONSTRAINT "sumula_operadores_match_day_id_match_days_id_fk" FOREIGN KEY ("match_day_id") REFERENCES "public"."match_days"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sumula_operadores" ADD CONSTRAINT "sumula_operadores_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sumula_operadores" ADD CONSTRAINT "sumula_operadores_created_by_player_id_players_id_fk" FOREIGN KEY ("created_by_player_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sumula_operadores_player_idx" ON "sumula_operadores" USING btree ("player_id");--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_created_by_player_id_players_id_fk" FOREIGN KEY ("created_by_player_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_desfeito_por_player_id_players_id_fk" FOREIGN KEY ("desfeito_por_player_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "goals_game_idx" ON "goals" USING btree ("game_id");--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_autor_ou_lado" CHECK ("goals"."player_id" is not null or "goals"."side" is not null);