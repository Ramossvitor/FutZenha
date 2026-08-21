-- A carteira, o extrato, o inventario e os ajustes da loja.
--
-- Segunda das tres migrations da zenha. A 0030 criou os tipos; esta traz as
-- tabelas que os usam. Cinco decisoes estao gravadas aqui em forma de
-- constraint, e cada uma existe porque a alternativa ja falhou em algum lugar:
--
-- 1. `zenha_carteiras.saldo` e MATERIALIZADO, com check de nao-negativo. O
--    debito e `UPDATE ... WHERE saldo >= $2 RETURNING`, e zero linhas e compra
--    recusada -- e o mesmo idioma do `WHERE status = 'open' RETURNING` de
--    fecharRodada, e e o que serializa duas compras simultaneas sem lock
--    nenhum. Com saldo derivado de sum(amount) nao haveria linha para travar:
--    as duas transacoes leriam a mesma soma e as duas passariam.
--
-- 2. `zenha_ledger` e APPEND-ONLY, com unique(player_id, dedupe_key). A nota faz
--    o oposto -- replay completo desde 5,0 a cada denuncia aceita --, mas zenha
--    vira badge, e nao existe replay de um gasto. Por isso o credito espera o
--    fut amadurecer e sai uma vez so, ja sobre fato congelado. A unique deixa o
--    varredor passar duas vezes pelo mesmo fut sem pagar em dobro.
--
-- 3. As FKs do ledger para round/match_day/inventario sao `set null`, NUNCA
--    cascade: apagar um fut nao pode evaporar dinheiro que ja virou item. E por
--    isso `descricao` e congelada na gravacao em vez de montada por join na
--    leitura -- quando o fut morre, a linha do extrato continua legivel.
--
-- 4. As duas uniques parciais de `zenha_inventario` sao as duas regras do
--    produto garantidas pelo banco: cosmetico nao se compra duas vezes, e nao
--    se arma dois multiplicadores no mesmo fut.
--
-- 5. `zenha_equipados` tem PK composta (player_id, slot) -- o "um por slot"
--    garantido pelo banco, no espirito do group_members_admin_unico_idx.
--    Equipar vira onConflictDoUpdate na PK, e nao "apaga o antigo, insere o
--    novo", que teria uma janela entre as duas escritas.
--
-- `zenha_config` guarda SO as sobrescritas do admin: chave ausente vale o
-- padrao de src/lib/zenha.ts e src/lib/loja-catalogo.ts. Espelhar todos os
-- valores numa tabela pediria migration a cada item novo do catalogo. Mudar um
-- valor vale dali para frente -- o append-only do ledger da isso de graca, e
-- nao ha codigo de reprocessamento a escrever.
CREATE TABLE "zenha_carteiras" (
	"player_id" integer PRIMARY KEY NOT NULL,
	"saldo" integer DEFAULT 0 NOT NULL,
	"atualizado_em" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "zenha_carteiras_saldo_nao_negativo" CHECK ("zenha_carteiras"."saldo" >= 0)
);
--> statement-breakpoint
CREATE TABLE "zenha_config" (
	"chave" text PRIMARY KEY NOT NULL,
	"valor" integer NOT NULL,
	"atualizado_em" timestamp DEFAULT now() NOT NULL,
	"atualizado_por_player_id" integer
);
--> statement-breakpoint
CREATE TABLE "zenha_equipados" (
	"player_id" integer NOT NULL,
	"slot" "zenha_slot" NOT NULL,
	"inventario_id" integer NOT NULL,
	"equipado_em" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "zenha_equipados_player_id_slot_pk" PRIMARY KEY("player_id","slot"),
	CONSTRAINT "zenha_equipados_inventario_id_unique" UNIQUE("inventario_id")
);
--> statement-breakpoint
CREATE TABLE "zenha_inventario" (
	"id" serial PRIMARY KEY NOT NULL,
	"player_id" integer NOT NULL,
	"item_id" text NOT NULL,
	"preco_pago" integer NOT NULL,
	"consumivel" boolean DEFAULT false NOT NULL,
	"fator_percent" integer,
	"adquirido_em" timestamp DEFAULT now() NOT NULL,
	"armado_match_day_id" integer,
	"armado_em" timestamp with time zone,
	"corte_previsto" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "zenha_ledger" (
	"id" serial PRIMARY KEY NOT NULL,
	"player_id" integer NOT NULL,
	"motivo" "zenha_motivo" NOT NULL,
	"amount" integer NOT NULL,
	"dedupe_key" text NOT NULL,
	"round_id" integer,
	"match_day_id" integer,
	"inventario_id" integer,
	"descricao" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "zenha_ledger_dedupe_unq" UNIQUE("player_id","dedupe_key"),
	CONSTRAINT "zenha_ledger_amount_nao_zero" CHECK ("zenha_ledger"."amount" <> 0)
);
--> statement-breakpoint
ALTER TABLE "match_days" ADD COLUMN "liquidado_em" timestamp;--> statement-breakpoint
ALTER TABLE "zenha_carteiras" ADD CONSTRAINT "zenha_carteiras_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zenha_config" ADD CONSTRAINT "zenha_config_atualizado_por_player_id_players_id_fk" FOREIGN KEY ("atualizado_por_player_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zenha_equipados" ADD CONSTRAINT "zenha_equipados_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zenha_equipados" ADD CONSTRAINT "zenha_equipados_inventario_id_zenha_inventario_id_fk" FOREIGN KEY ("inventario_id") REFERENCES "public"."zenha_inventario"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zenha_inventario" ADD CONSTRAINT "zenha_inventario_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zenha_inventario" ADD CONSTRAINT "zenha_inventario_armado_match_day_id_match_days_id_fk" FOREIGN KEY ("armado_match_day_id") REFERENCES "public"."match_days"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zenha_ledger" ADD CONSTRAINT "zenha_ledger_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zenha_ledger" ADD CONSTRAINT "zenha_ledger_round_id_rating_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rating_rounds"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zenha_ledger" ADD CONSTRAINT "zenha_ledger_match_day_id_match_days_id_fk" FOREIGN KEY ("match_day_id") REFERENCES "public"."match_days"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zenha_ledger" ADD CONSTRAINT "zenha_ledger_inventario_id_zenha_inventario_id_fk" FOREIGN KEY ("inventario_id") REFERENCES "public"."zenha_inventario"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "zenha_inventario_unico_idx" ON "zenha_inventario" USING btree ("player_id","item_id") WHERE "zenha_inventario"."consumivel" = false;--> statement-breakpoint
CREATE UNIQUE INDEX "zenha_inventario_arme_unico_idx" ON "zenha_inventario" USING btree ("player_id","armado_match_day_id") WHERE "zenha_inventario"."armado_match_day_id" is not null;--> statement-breakpoint
CREATE INDEX "zenha_inventario_jogador_idx" ON "zenha_inventario" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "zenha_ledger_extrato_idx" ON "zenha_ledger" USING btree ("player_id","created_at");
-- Sem saldo de estreia, e sem backfill de historico: TODO MUNDO comeca em zero,
-- inclusive quem joga desde o primeiro fut. Zenha se ganha jogando, e a unica
-- porta de entrada e a liquidacao do fut (src/lib/zenha-engine.ts).
--
-- A carteira tambem nao nasce aqui. Quem a cria e o proprio `creditar`, no
-- primeiro credito de liquidacao, com upsert -- linha de saldo zero para todo
-- mundo seria estado que nao significa nada.
