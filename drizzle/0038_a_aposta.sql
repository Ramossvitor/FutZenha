-- A aposta: zenha do jogador na PRÓPRIA vitória, às cegas.
--
-- Uma tabela e uma coluna. `zenha_apostas` é a aposta em si, e os estados dela
-- são timestamp em vez de enum mutável: `resolvida_em is null` é a aposta viva, e
-- o `UPDATE ... WHERE resolvida_em IS NULL RETURNING` é o exatamente-uma-vez por
-- linha — o que impede a devolução dupla quando o gancho do fut apagado cruza com
-- a varredura. `match_days.apostas_liquidadas_em` é a trava do exatamente-uma-vez
-- do FUT, gêmea de `liquidado_em` e separada dela porque o critério é outro: a
-- zenha paga quando a rodada de avaliação fecha, e a aposta paga por PLACAR —
-- que segue editável por JANELA_CORRECAO_HORAS depois do encerramento.
--
-- Não há `team_id` aqui de propósito: a aposta fecha enquanto o fut ainda está
-- `scheduled` (antes de os times existirem) e o time por que a pessoa disputou
-- sai do snapshot `game_players` na liquidação. Um ponteiro para `teams` não
-- sobreviveria ao re-sorteio, que apaga e recria a tabela inteira.
--
-- Os três motivos novos do ledger: `aposta` é a segunda linha negativa (a
-- primeira é `compra`), `premio_aposta` paga só o que saiu de outras apostas
-- (pote dividido, soma zero — nunca zenha nova) e `aposta_devolvida` é uma linha
-- NOVA positiva, não uma reversão: o ledger continua append-only.
--
-- Nenhum comando abaixo USA os valores novos de enum, que é o que permite eles
-- conviverem com o CREATE TABLE na mesma migration (a lição da 0030, repetida na
-- 0036). Ver o cabeçalho da aposta em src/db/schema.ts.
ALTER TYPE "public"."notification_type" ADD VALUE 'aposta_resolvida';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'aposta_devolvida';--> statement-breakpoint
ALTER TYPE "public"."zenha_motivo" ADD VALUE 'aposta';--> statement-breakpoint
ALTER TYPE "public"."zenha_motivo" ADD VALUE 'premio_aposta';--> statement-breakpoint
ALTER TYPE "public"."zenha_motivo" ADD VALUE 'aposta_devolvida';--> statement-breakpoint
CREATE TABLE "zenha_apostas" (
	"id" serial PRIMARY KEY NOT NULL,
	"match_day_id" integer NOT NULL,
	"player_id" integer NOT NULL,
	"valor" integer NOT NULL,
	"criada_em" timestamp DEFAULT now() NOT NULL,
	"resolvida_em" timestamp,
	"retorno" integer,
	"desfecho" text,
	"time_nome" text,
	CONSTRAINT "zenha_apostas_valor_positivo" CHECK ("zenha_apostas"."valor" > 0),
	CONSTRAINT "zenha_apostas_desfecho_valido" CHECK ("zenha_apostas"."desfecho" is null or "zenha_apostas"."desfecho" in ('paga', 'perdida', 'devolvida', 'cancelada')),
	CONSTRAINT "zenha_apostas_resolucao_junta" CHECK (("zenha_apostas"."resolvida_em" is null) = ("zenha_apostas"."desfecho" is null) and ("zenha_apostas"."resolvida_em" is null) = ("zenha_apostas"."retorno" is null)),
	CONSTRAINT "zenha_apostas_retorno_coerente" CHECK ("zenha_apostas"."desfecho" is null
        or ("zenha_apostas"."desfecho" = 'perdida' and "zenha_apostas"."retorno" = 0)
        or ("zenha_apostas"."desfecho" in ('devolvida', 'cancelada') and "zenha_apostas"."retorno" = "zenha_apostas"."valor")
        or ("zenha_apostas"."desfecho" = 'paga' and "zenha_apostas"."retorno" >= "zenha_apostas"."valor"))
);
--> statement-breakpoint
ALTER TABLE "match_days" ADD COLUMN "apostas_liquidadas_em" timestamp;--> statement-breakpoint
ALTER TABLE "zenha_apostas" ADD CONSTRAINT "zenha_apostas_match_day_id_match_days_id_fk" FOREIGN KEY ("match_day_id") REFERENCES "public"."match_days"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zenha_apostas" ADD CONSTRAINT "zenha_apostas_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "zenha_apostas_ativa_unq" ON "zenha_apostas" USING btree ("match_day_id","player_id") WHERE resolvida_em is null;--> statement-breakpoint
CREATE INDEX "zenha_apostas_fut_idx" ON "zenha_apostas" USING btree ("match_day_id");