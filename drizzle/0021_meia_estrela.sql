-- Meia estrela: a unidade do voto vira meias-estrelas inteiras (1..10) e a
-- régua nova é linear (meia = 1 ponto). Rodadas já apuradas ficam congeladas
-- na tabela antiga via legacy_scale — rodadas ainda abertas migram para a
-- régua nova (decisão de produto: os poucos votos delas são re-valorados).
-- A ordem importa: o check antigo (1..5) precisa cair ANTES do dobro, e o
-- novo (1..10) só entra DEPOIS.
ALTER TABLE "rating_rounds" ADD COLUMN "legacy_scale" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "rating_rounds" SET "legacy_scale" = true WHERE "status" = 'closed';--> statement-breakpoint
ALTER TABLE "ratings" RENAME COLUMN "stars" TO "half_stars";--> statement-breakpoint
ALTER TABLE "ratings" DROP CONSTRAINT "ratings_stars_check";--> statement-breakpoint
UPDATE "ratings" SET "half_stars" = "half_stars" * 2;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_half_stars_check" CHECK ("ratings"."half_stars" between 1 and 10);