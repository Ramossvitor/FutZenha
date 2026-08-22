-- A vitrine da loja: o catálogo sai do código e vira dado.
--
-- O que muda de forma: `zenha_inventario.item_id` deixa de ser text solto e
-- passa a ser integer com FK para `loja_itens`, e `zenha_slot` perde o valor
-- 'badge' (badge virou coleção em `zenha_vitrine`, não mais um slot de vaga
-- única). Nenhuma das duas coisas tem tradução automática de dado existente:
-- não há de onde tirar o id numérico de um 'dono-da-bola' que era string, e um
-- equipado em 'badge' não teria para onde ir.
--
-- Por isso a GUARDA logo abaixo, e por isso ela RECUSA em vez de apagar. Em
-- produção o inventário está vazio por construção — a economia só começa a
-- pagar em ZENHA_DESDE (2026-09-01, src/lib/zenha.ts) e ninguém tem zenha para
-- gastar antes disso. Se um dia esta migration alcançar um banco com compras,
-- a resposta certa é parar o deploy e escrever a migração de dados: apagar
-- silenciosamente seria evaporar item pago, com o dinheiro já fora do ledger
-- append-only e sem estorno a rodar.
--
-- Em desenvolvimento, o conserto é esvaziar o inventário NO BANCO QUE RECUSOU e
-- migrar de novo: `truncate zenha_inventario cascade` (ou, nos bancos de teste
-- futzenha_test e futzenha_e2e, `drop database` — os global-setups recriam).
-- Não é `npm run seed`: ele aponta para a DATABASE_URL do .env, então não
-- alcança o banco de teste que recusou, e no banco de dev ele já apaga
-- `loja_itens` — tabela que só existe DEPOIS desta migration.
--
-- Antes do deploy: esta migration é exatamente o caso de "Migration arriscada"
-- do README (passa lisa no banco vazio do gate e recusa num banco com dado).
-- Rode o dry-run num branch do Neon (`DIRECT_DATABASE_URL=<branch> npm run
-- db:migrate:prod`) antes de disparar o workflow.
DO $$ BEGIN
	IF EXISTS (SELECT 1 FROM "zenha_inventario") THEN
		RAISE EXCEPTION 'A migration 0033 exige zenha_inventario VAZIA: ela troca o tipo de item_id e recria o enum zenha_slot, e nenhuma das duas coisas traduz dado existente. Em dev, esvazie o inventário NESTE banco (truncate zenha_inventario cascade) e migre de novo — não é `npm run seed`. Em produção, isto é um deploy a parar: escreva a migração de dados.';
	END IF;
END $$;--> statement-breakpoint
CREATE TYPE "public"."loja_tipo" AS ENUM('badge', 'moldura', 'cor_do_nome', 'titulo', 'consumivel');--> statement-breakpoint
CREATE TABLE "loja_imagens" (
	"item_id" integer PRIMARY KEY NOT NULL,
	"hash" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" "bytea" NOT NULL,
	"atualizado_em" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "loja_imagens_mime_aceito" CHECK ("loja_imagens"."mime" in ('image/png', 'image/jpeg', 'image/webp'))
);
--> statement-breakpoint
CREATE TABLE "loja_itens" (
	"id" serial PRIMARY KEY NOT NULL,
	"tipo" "loja_tipo" NOT NULL,
	"nome" text NOT NULL,
	"descricao" text DEFAULT '' NOT NULL,
	"preco" integer NOT NULL,
	"cor" text,
	"imagem_hash" text,
	"efeito" text,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp DEFAULT now() NOT NULL,
	"atualizado_em" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "loja_itens_preco_valido" CHECK ("loja_itens"."preco" >= 0 and "loja_itens"."preco" <= 100000),
	CONSTRAINT "loja_itens_cor_valida" CHECK ("loja_itens"."cor" is null or "loja_itens"."cor" ~ '^#[0-9a-f]{6}$'),
	CONSTRAINT "loja_itens_cor_por_tipo" CHECK (("loja_itens"."tipo" in ('moldura', 'cor_do_nome')) = ("loja_itens"."cor" is not null)),
	CONSTRAINT "loja_itens_imagem_por_tipo" CHECK (("loja_itens"."tipo" = 'badge') = ("loja_itens"."imagem_hash" is not null)),
	CONSTRAINT "loja_itens_efeito_por_tipo" CHECK (("loja_itens"."tipo" = 'consumivel') = ("loja_itens"."efeito" is not null)),
	CONSTRAINT "loja_itens_efeito_conhecido" CHECK ("loja_itens"."efeito" is null or "loja_itens"."efeito" in ('multiplicador'))
);
--> statement-breakpoint
CREATE TABLE "zenha_vitrine" (
	"player_id" integer NOT NULL,
	"posicao" integer NOT NULL,
	"inventario_id" integer NOT NULL,
	"destaque" boolean DEFAULT false NOT NULL,
	"colocado_em" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "zenha_vitrine_player_id_posicao_pk" PRIMARY KEY("player_id","posicao"),
	CONSTRAINT "zenha_vitrine_inventario_id_unique" UNIQUE("inventario_id"),
	CONSTRAINT "zenha_vitrine_posicao_valida" CHECK ("zenha_vitrine"."posicao" between 1 and 5)
);
--> statement-breakpoint
ALTER TABLE "zenha_equipados" ALTER COLUMN "slot" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."zenha_slot";--> statement-breakpoint
CREATE TYPE "public"."zenha_slot" AS ENUM('moldura', 'cor_do_nome', 'titulo');--> statement-breakpoint
ALTER TABLE "zenha_equipados" ALTER COLUMN "slot" SET DATA TYPE "public"."zenha_slot" USING "slot"::"public"."zenha_slot";--> statement-breakpoint
-- À MÃO: o `USING`. O drizzle-kit não o emite para text → integer, e o Postgres
-- recusa a conversão sem ele mesmo com a tabela vazia (a guarda lá em cima
-- garante que ela está).
ALTER TABLE "zenha_inventario" ALTER COLUMN "item_id" SET DATA TYPE integer USING "item_id"::integer;--> statement-breakpoint
ALTER TABLE "loja_imagens" ADD CONSTRAINT "loja_imagens_item_id_loja_itens_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."loja_itens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zenha_vitrine" ADD CONSTRAINT "zenha_vitrine_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zenha_vitrine" ADD CONSTRAINT "zenha_vitrine_inventario_id_zenha_inventario_id_fk" FOREIGN KEY ("inventario_id") REFERENCES "public"."zenha_inventario"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "loja_itens_efeito_unico_idx" ON "loja_itens" USING btree ("efeito") WHERE "loja_itens"."efeito" is not null;--> statement-breakpoint
CREATE INDEX "loja_itens_vitrine_idx" ON "loja_itens" USING btree ("ativo","tipo","preco");--> statement-breakpoint
CREATE UNIQUE INDEX "zenha_vitrine_destaque_unico_idx" ON "zenha_vitrine" USING btree ("player_id") WHERE "zenha_vitrine"."destaque";--> statement-breakpoint
ALTER TABLE "zenha_inventario" ADD CONSTRAINT "zenha_inventario_item_id_loja_itens_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."loja_itens"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- À MÃO (dado): o multiplicador de nota.
--
-- É a única linha que o CÓDIGO exige existir: o efeito dele é implementado
-- (src/lib/multiplicador-engine.ts), o admin pode mudar preço e texto mas não
-- pode criá-lo nem apagá-lo, e a loja sem ele perderia o único item que mexe no
-- jogo. Todo o resto do catálogo nasce vazio de propósito — os vinte e cinco
-- itens de texto que existiam aqui eram justamente o que se decidiu jogar fora.
--
-- O preço herda a sobrescrita do admin, se houver: `multiplicador_preco_base`
-- era um ajuste da economia e passa a ser a coluna `preco` desta linha. Sem o
-- coalesce, quem tivesse ajustado o preço veria o número voltar ao padrão sem
-- ninguém ter mexido.
--
-- `WHERE NOT EXISTS` para a migration continuar idempotente se rodar de novo
-- num banco que já a aplicou por outro caminho (o gate do CI roda duas vezes).
INSERT INTO "loja_itens" ("tipo", "nome", "descricao", "preco", "efeito")
SELECT
	'consumivel',
	'Multiplicador de nota',
	'Arma num fut e amplia o movimento da sua nota. Nos dois sentidos — é aposta, não presente.',
	coalesce((SELECT "valor" FROM "zenha_config" WHERE "chave" = 'multiplicador_preco_base' AND "valor" BETWEEN 0 AND 5000), 120),
	'multiplicador'
WHERE NOT EXISTS (SELECT 1 FROM "loja_itens" WHERE "efeito" = 'multiplicador');--> statement-breakpoint
-- À MÃO (dado): as chaves que perderam o dono.
--
-- `preco:{itemId}` guardava o preço sobrescrito de um item do catálogo em
-- código, e `multiplicador_preco_base` era o preço-base do consumível. Os dois
-- números agora são a coluna `loja_itens.preco`. Deixar as linhas para trás
-- encheria de lixo o "Sobrescrito hoje" do painel do admin — e um dia alguém
-- confiaria nelas.
DELETE FROM "zenha_config" WHERE "chave" LIKE 'preco:%' OR "chave" = 'multiplicador_preco_base';
