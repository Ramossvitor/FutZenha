ALTER TABLE "match_days" ADD COLUMN "finished_at" timestamp;--> statement-breakpoint
-- Peladas já encerradas antes desta coluna existir: usa a data da própria
-- pelada. Sem isto elas ficariam com finished_at nulo e a janela de 24h para
-- corrigir placar não teria a partir de quando contar.
UPDATE "match_days" SET "finished_at" = "date"::timestamp WHERE "status" = 'finished' AND "finished_at" IS NULL;