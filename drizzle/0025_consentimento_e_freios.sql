-- Freios de abuso, tudo aditivo (nenhuma linha existente muda).
--
-- `attendances.agenda_email_sent_at` e o ledger do freio de e-mail de agenda
-- (src/lib/freios-de-envio.ts). Ele nao tinha freio NENHUM: confirmar e sair da
-- lista em loop mandava dois e-mails por ciclo, ilimitado, contra a cota de
-- 100/dia do Resend -- a mesma cota do link de redefinicao de acesso. E uma
-- coluna de dominio, e nao tabela de contador, pelo mesmo motivo que
-- `invites.email_sent_at` e: a linha que registra o envio ja e o ledger.
--
-- `players.created_by_player_id` e por quem os tetos de criacao contam
-- (src/lib/tetos-de-criacao.ts). `convidarParaFut` criava linha em `players`
-- com nome a escolha e sem limite -- o que enche a tabela, alimenta o fan-out
-- de aviso e, porque `players.name` e UNIQUE, permite tomar um nome antes que
-- ele vire admin (ver src/db/platform-admins-bootstrap.ts).
--
-- Os tres indices servem as tres perguntas de teto: "quantos X este jogador
-- criou nas ultimas 24h". O de attendances e parcial porque so linha carimbada
-- interessa, e quase nenhuma presenca gera e-mail.

ALTER TABLE "attendances" ADD COLUMN "agenda_email_sent_at" timestamp;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "created_by_player_id" integer;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_created_by_player_id_players_id_fk" FOREIGN KEY ("created_by_player_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attendances_agenda_envio_idx" ON "attendances" USING btree ("player_id","agenda_email_sent_at") WHERE agenda_email_sent_at is not null;--> statement-breakpoint
CREATE INDEX "groups_criador_idx" ON "groups" USING btree ("created_by_player_id","created_at");--> statement-breakpoint
CREATE INDEX "match_days_criador_idx" ON "match_days" USING btree ("created_by_player_id","created_at");--> statement-breakpoint
CREATE INDEX "players_criador_idx" ON "players" USING btree ("created_by_player_id","created_at");