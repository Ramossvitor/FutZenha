ALTER TYPE "public"."notification_type" ADD VALUE 'pelada_criada';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'pelada_times_sorteados';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'pelada_lembrete_vespera';--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "push_dispatched_at" timestamp;--> statement-breakpoint
-- Backfill manual (fora do gerador): sem ele, todo o histórico de avisos nasce
-- "pendente de push" e o primeiro despacho pós-deploy trata anos de caixa de
-- entrada como fila. Independente da ordem de rollout: mesmo sem nenhuma
-- assinatura cadastrada, o custo seria varrer e marcar tudo na primeira rodada.
UPDATE "notifications" SET "push_dispatched_at" = now();--> statement-breakpoint
CREATE INDEX "notifications_push_pendentes_idx" ON "notifications" USING btree ("id") WHERE push_dispatched_at is null;