ALTER TABLE "players" ALTER COLUMN "skill" SET DATA TYPE numeric(3, 1);--> statement-breakpoint
ALTER TABLE "players" ALTER COLUMN "skill" SET DEFAULT 5;--> statement-breakpoint
-- A nota passa a ser 100% calculada pelas avaliações dos companheiros, então as
-- notas digitadas pelo admin até aqui não têm como ser reaproveitadas: todo
-- mundo recomeça do meio da escala.
UPDATE "players" SET "skill" = 5.0;