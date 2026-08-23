-- Trocar de lado no meio do jogo, na súmula ao vivo.
--
-- Na quadra alguém muda de time com o jogo rolando (lesão, time desfalcado,
-- chegou gente) e a súmula não tinha como registrar: `lancarGol` recusa gol de
-- quem está escalado do outro lado, e a única troca que existia era a do
-- /gerenciar/encerrar, de admin e depois do jogo.
--
-- A tabela nova é LOG. O estado continua onde sempre esteve, e é por isso que
-- esta migration não faz backfill nenhum: `game_players.side` (o lado em que a
-- pessoa terminou o jogo, de onde já saem o V/E/D e os companheiros da
-- avaliação) e `team_players` (o colete, para o próximo jogo nascer certo).
-- Súmula aberta agora não precisa de nada: as linhas de escalação já existem e
-- esta tabela nasce vazia.
--
-- Aditiva e sem guarda: só cria tabela, FKs e índice.
CREATE TABLE "trocas_de_lado" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" integer NOT NULL,
	"player_id" integer NOT NULL,
	"de_lado" "game_side" NOT NULL,
	"para_lado" "game_side" NOT NULL,
	"created_by_player_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "trocas_de_lado_lados_distintos" CHECK ("trocas_de_lado"."de_lado" <> "trocas_de_lado"."para_lado")
);
--> statement-breakpoint
ALTER TABLE "trocas_de_lado" ADD CONSTRAINT "trocas_de_lado_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trocas_de_lado" ADD CONSTRAINT "trocas_de_lado_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trocas_de_lado" ADD CONSTRAINT "trocas_de_lado_created_by_player_id_players_id_fk" FOREIGN KEY ("created_by_player_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trocas_de_lado_game_idx" ON "trocas_de_lado" USING btree ("game_id");