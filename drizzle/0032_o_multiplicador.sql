-- O multiplicador: o fato durável que o replay da nota consome.
--
-- Terceira e ultima migration da zenha. A 0030 trouxe os tipos, a 0031 a
-- carteira e a loja; esta traz o unico item que mexe no jogo.
--
-- ── Por que uma TABELA, e nao uma coluna de efeito ────────────────────────
-- A nota nao e um acumulado: ela e o replay completo do historico desde 5,0,
-- refeito a cada denuncia aceita e a cada fut apagado (src/lib/skill.ts).
-- Guardar "esta nota ja veio multiplicada" nao resolveria nada -- o replay
-- reescreve a nota inteira na passada seguinte. O que precisa sobreviver e a
-- CAUSA: quem armou, em que fut, com que forca. Com o fato aqui, o replay
-- reproduz a rodada antiga exatamente como ela foi, e nao existe uma linha de
-- codigo de desfazimento em lugar nenhum.
--
-- ── Por que o fator e congelado ───────────────────────────────────────────
-- `fator_num`/`fator_den` sao copiados do inventario, onde foram congelados na
-- compra. O admin pode mudar a forca do multiplicador amanha; a rodada de dois
-- meses atras continua replaiando com a forca da epoca, para sempre. Sem isso,
-- mexer num ajuste reescreveria a nota de todo mundo que ja usou o item.
--
-- ── Por que CASCADE no match_day_id ──────────────────────────────────────
-- Nao e estilo, e sobrevivencia. `apagarFut` (src/lib/deletion.ts) e hard
-- delete e roda dentro de `processarPendencias`, cujo `.catch` so escreve no
-- log. Com `no action` (o default do drizzle), apagar um fut com multiplicador
-- armado estouraria a FK e pararia a varredura INTEIRA em silencio: rodada
-- nunca mais fecha por prazo, denuncia nunca mais resolve, lembrete de vespera
-- nunca mais sai. Mas o cascade some com o FATO, e so com ele: devolver o item
-- ao dono e outra escrita, porque `zenha_inventario.consumido_em` e coluna do
-- inventario e o cascade nao a alcanca. Quem devolve e
-- `soltarMultiplicadoresDoFut`, chamada por `apagarFut` antes do delete.
--
-- A PK composta (match_day_id, player_id) e o "nao empilha" garantido pelo
-- BANCO: dois multiplicadores no mesmo fut nao existem, e por isso o replay
-- pode ler o fator como um VALOR em vez de contar linhas.
--
-- `skill_history.multiplicado` e a marca publica. O multiplicador e a unica
-- coisa do sistema que faz a nota andar mais rapido por dinheiro; deixar isso
-- sem marca seria pior que a regra, porque a DESCOBERTA e que viraria o
-- problema. Default false cobre todo o historico anterior, que nao teve
-- multiplicador nenhum.
--
-- `zenha_inventario.consumido_em` fecha o buraco que o cascade acima cria: o
-- item consumido NAO pode ser apagado do inventario, porque o fato aponta para
-- ele. Sem uma marca, limpar so as colunas do arme no encerramento devolveria o
-- multiplicador a prateleira depois de gasto -- uma compra viraria
-- multiplicador infinito.
CREATE TABLE "zenha_multiplicadores" (
	"match_day_id" integer NOT NULL,
	"player_id" integer NOT NULL,
	"inventario_id" integer NOT NULL,
	"fator_num" integer NOT NULL,
	"fator_den" integer NOT NULL,
	"aplicado_em" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "zenha_multiplicadores_match_day_id_player_id_pk" PRIMARY KEY("match_day_id","player_id"),
	CONSTRAINT "zenha_multiplicadores_inventario_id_unique" UNIQUE("inventario_id"),
	CONSTRAINT "zenha_multiplicadores_fator_valido" CHECK ("zenha_multiplicadores"."fator_num" > "zenha_multiplicadores"."fator_den" and "zenha_multiplicadores"."fator_den" > 0)
);
--> statement-breakpoint
ALTER TABLE "skill_history" ADD COLUMN "multiplicado" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "zenha_inventario" ADD COLUMN "consumido_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "zenha_multiplicadores" ADD CONSTRAINT "zenha_multiplicadores_match_day_id_match_days_id_fk" FOREIGN KEY ("match_day_id") REFERENCES "public"."match_days"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zenha_multiplicadores" ADD CONSTRAINT "zenha_multiplicadores_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zenha_multiplicadores" ADD CONSTRAINT "zenha_multiplicadores_inventario_id_zenha_inventario_id_fk" FOREIGN KEY ("inventario_id") REFERENCES "public"."zenha_inventario"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "zenha_multiplicadores_jogador_idx" ON "zenha_multiplicadores" USING btree ("player_id");