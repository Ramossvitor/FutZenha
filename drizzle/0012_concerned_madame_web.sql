ALTER TYPE "public"."attendance_status" ADD VALUE 'waitlist';--> statement-breakpoint
ALTER TYPE "public"."attendance_status" ADD VALUE 'no_show';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'pelada_presenca_definida';--> statement-breakpoint
ALTER TABLE "attendances" ADD COLUMN "confirmed_at" timestamp;--> statement-breakpoint
ALTER TABLE "match_days" ADD COLUMN "max_players" integer;--> statement-breakpoint
-- Presença que já existe não tem ordem de chegada: `updated_at` é o mais perto
-- disso que o banco guarda. Sem este backfill, toda lista anterior a esta
-- migration ficaria com confirmed_at nulo e ordenaria por id — que é ordem de
-- cadastro do jogador, não de quem chegou primeiro. Só quem está na lista
-- ganha marco: `out` é justamente quem não tem.
UPDATE "attendances" SET "confirmed_at" = "updated_at" WHERE "status" <> 'out';