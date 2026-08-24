-- A recarga: zenha comprada com dinheiro de verdade, via Pix.
--
-- Duas tabelas novas e uma coluna. `zenha_pacotes` é o cardápio (dado, não
-- código — o admin ajusta sem deploy); `zenha_pedidos` é a ponte entre a
-- cobrança no gateway e o ledger, e é nela que mora o exatamente-uma-vez do
-- crédito (`UPDATE ... WHERE status = 'pendente' RETURNING` + a unique de
-- dedupe do ledger + a unique de `gateway_id`). `zenha_ledger.pedido_id` é a
-- navegação do extrato de volta ao pedido, `set null` como as outras FKs.
--
-- `zenha_pedidos.ultima_consulta_em` é o freio da sonda da tela: sem ela, uma
-- aba aberta pergunta ao gateway a cada tique de 5s pelos 30 minutos do QR.
-- Quem reivindica o direito de consultar é `UPDATE ... WHERE ultima_consulta_em
-- < now() - intervalo RETURNING` — o mesmo idioma do resto, e é ele que também
-- serializa duas abas do mesmo pedido.
--
-- O ledger continua append-only e sem estorno: devolução de dinheiro no
-- gateway NÃO debita zenha — o pedido vira 'estornado' e os admins decidem.
-- Ver o cabeçalho da recarga em src/db/schema.ts.
CREATE TYPE "public"."recarga_status" AS ENUM('pendente', 'pago', 'expirado', 'cancelado', 'estornado');--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'recarga_confirmada';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'recarga_estornada';--> statement-breakpoint
ALTER TYPE "public"."zenha_motivo" ADD VALUE 'recarga';--> statement-breakpoint
CREATE TABLE "zenha_pacotes" (
	"id" serial PRIMARY KEY NOT NULL,
	"nome" text NOT NULL,
	"preco_centavos" integer NOT NULL,
	"zenhas" integer NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"ordem" integer DEFAULT 0 NOT NULL,
	"criado_em" timestamp DEFAULT now() NOT NULL,
	"atualizado_em" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "zenha_pacotes_preco_valido" CHECK ("zenha_pacotes"."preco_centavos" > 0 and "zenha_pacotes"."preco_centavos" <= 100000),
	CONSTRAINT "zenha_pacotes_zenhas_validas" CHECK ("zenha_pacotes"."zenhas" > 0 and "zenha_pacotes"."zenhas" <= 100000)
);
--> statement-breakpoint
CREATE TABLE "zenha_pedidos" (
	"id" serial PRIMARY KEY NOT NULL,
	"player_id" integer NOT NULL,
	"pacote_id" integer NOT NULL,
	"preco_centavos" integer NOT NULL,
	"zenhas" integer NOT NULL,
	"gateway" text DEFAULT 'mercadopago' NOT NULL,
	"gateway_id" text,
	"idempotency_key" text NOT NULL,
	"status" "recarga_status" DEFAULT 'pendente' NOT NULL,
	"qr_code" text,
	"qr_code_base64" text,
	"expira_em" timestamp with time zone,
	"criado_em" timestamp DEFAULT now() NOT NULL,
	"pago_em" timestamp with time zone,
	"estornado_em" timestamp with time zone,
	"ultima_consulta_em" timestamp with time zone,
	"ultimo_evento" jsonb,
	CONSTRAINT "zenha_pedidos_gateway_id_unique" UNIQUE("gateway_id"),
	CONSTRAINT "zenha_pedidos_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "zenha_pedidos_preco_valido" CHECK ("zenha_pedidos"."preco_centavos" > 0),
	CONSTRAINT "zenha_pedidos_zenhas_validas" CHECK ("zenha_pedidos"."zenhas" > 0),
	CONSTRAINT "zenha_pedidos_gateway_conhecido" CHECK ("zenha_pedidos"."gateway" in ('mercadopago')),
	CONSTRAINT "zenha_pedidos_gateway_id_por_status" CHECK (("zenha_pedidos"."gateway_id" is not null) or ("zenha_pedidos"."status" = 'cancelado'))
);
--> statement-breakpoint
ALTER TABLE "zenha_ledger" ADD COLUMN "pedido_id" integer;--> statement-breakpoint
ALTER TABLE "zenha_pedidos" ADD CONSTRAINT "zenha_pedidos_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zenha_pedidos" ADD CONSTRAINT "zenha_pedidos_pacote_id_zenha_pacotes_id_fk" FOREIGN KEY ("pacote_id") REFERENCES "public"."zenha_pacotes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "zenha_pacotes_vitrine_idx" ON "zenha_pacotes" USING btree ("ativo","ordem");--> statement-breakpoint
CREATE INDEX "zenha_pedidos_jogador_idx" ON "zenha_pedidos" USING btree ("player_id","criado_em");--> statement-breakpoint
CREATE INDEX "zenha_pedidos_pendentes_idx" ON "zenha_pedidos" USING btree ("criado_em") WHERE "zenha_pedidos"."status" = 'pendente';--> statement-breakpoint
ALTER TABLE "zenha_ledger" ADD CONSTRAINT "zenha_ledger_pedido_id_zenha_pedidos_id_fk" FOREIGN KEY ("pedido_id") REFERENCES "public"."zenha_pedidos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- À MÃO (dado): os três pacotes de estreia — R$ 10 → 250, R$ 20 → 550,
-- R$ 40 → 1.200. O mínimo e a escala são decisão de produto (2026-08-24); daqui
-- em diante quem mexe é o admin na tela, e o que já virou pedido está congelado
-- em `zenha_pedidos` de qualquer jeito.
--
-- `WHERE NOT EXISTS` pela mesma razão do multiplicador na 0033: a migration
-- continua idempotente num banco que já a aplicou por outro caminho (o gate do
-- CI roda duas vezes) — e não recria o cardápio por cima do que o admin editou.
INSERT INTO "zenha_pacotes" ("nome", "preco_centavos", "zenhas", "ordem")
SELECT * FROM (VALUES
	('Punhado', 1000, 250, 1),
	('Bolsa', 2000, 550, 2),
	('Baú', 4000, 1200, 3)
) AS pacotes ("nome", "preco_centavos", "zenhas", "ordem")
WHERE NOT EXISTS (SELECT 1 FROM "zenha_pacotes");
