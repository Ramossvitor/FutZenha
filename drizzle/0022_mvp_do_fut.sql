-- MVP do fut: o voto de melhor em campo mora na própria linha do avaliador
-- congelado (rating_round_raters) — a PK já dá "um voto por eleitor" e NULL é
-- "não votou", o que deixa todo envio anterior à feature válido sem backfill.
-- Nenhuma tabela de resultado: o vencedor é derivado dos votos na leitura,
-- como a nota é derivada das avaliações no replay.
ALTER TYPE "public"."notification_type" ADD VALUE 'mvp_do_fut';--> statement-breakpoint
ALTER TABLE "rating_round_raters" ADD COLUMN "mvp_player_id" integer;--> statement-breakpoint
ALTER TABLE "rating_round_raters" ADD CONSTRAINT "rating_round_raters_mvp_player_id_players_id_fk" FOREIGN KEY ("mvp_player_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rating_round_raters" ADD CONSTRAINT "rating_round_raters_mvp_no_self_check" CHECK ("rating_round_raters"."mvp_player_id" <> "rating_round_raters"."player_id");
