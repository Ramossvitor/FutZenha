ALTER TYPE "public"."notification_type" ADD VALUE 'loja_compra';--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "email_dispatched_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avisos_por_email" boolean DEFAULT true NOT NULL;--> statement-breakpoint
-- Backfill manual (fora do gerador), pelo mesmo motivo do irmão de push em
-- 0016: sem ele, todo o histórico de avisos nasce "pendente de e-mail" e o
-- primeiro despacho pós-deploy trata anos de caixa de entrada como fila. A
-- diferença é o custo do engano — push velho é um device vibrando à toa, e-mail
-- velho é uma caixa de entrada lotada por um lote que ninguém pediu, do tipo
-- que vira denúncia de spam e queima o domínio.
--
-- O despachante tem um segundo freio de idade (IDADE_MAXIMA_MS em
-- src/lib/email-avisos.ts), e ele NÃO torna esta linha dispensável: é rede de
-- segurança para o que escapar daqui, não substituto.
UPDATE "notifications" SET "email_dispatched_at" = now();--> statement-breakpoint
CREATE INDEX "notifications_email_pendentes_idx" ON "notifications" USING btree ("id") WHERE email_dispatched_at is null;
