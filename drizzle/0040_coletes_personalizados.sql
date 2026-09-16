-- Coletes personalizados: nome e cor do time deixam de ser a paleta fixa do código.
--
-- `teams.cor` é a cor do colete de cada time (`#rrggbb` minúsculo, como
-- `loja_itens.cor`); nula = "sem colete" — o time que joga sem camisa por cima,
-- desenhado como chip vazado. Até aqui a cor saía do NOME, por uma tabela de
-- sete cores em src/lib/team-colors.ts, e um time "Com Colete" saía cinza.
--
-- `coletes_do_grupo` é o molde que o sorteio copia para `teams`, na ordem: até
-- seis linhas por grupo (`sort_order between 0 and 5` é o par de TIMES_MAX no
-- banco). É cópia, e não ponteiro — editar o molde não mexe em fut já sorteado,
-- e apagar o grupo leva as linhas junto (cascade) sem tocar nos futs.
--
-- O UPDATE do fim é o backfill dos futs que já existem: os sete nomes clássicos
-- ganham a cor que sempre tiveram na tela (os antigos --vest-* do globals.css,
-- em minúsculas); nome inventado ("Roxo", "Time A") fica nulo — vazado — até
-- alguém definir a cor no /gerenciar. Idempotente pelo `WHERE cor IS NULL`, que
-- é o que o gate cobra ao rodar a migration duas vezes.
CREATE TABLE "coletes_do_grupo" (
	"group_id" integer NOT NULL,
	"sort_order" integer NOT NULL,
	"nome" text NOT NULL,
	"cor" text,
	CONSTRAINT "coletes_do_grupo_group_id_sort_order_pk" PRIMARY KEY("group_id","sort_order"),
	CONSTRAINT "coletes_do_grupo_ordem_valida" CHECK ("coletes_do_grupo"."sort_order" between 0 and 5),
	CONSTRAINT "coletes_do_grupo_cor_valida" CHECK ("coletes_do_grupo"."cor" is null or "coletes_do_grupo"."cor" ~ '^#[0-9a-f]{6}$')
);
--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "cor" text;--> statement-breakpoint
ALTER TABLE "coletes_do_grupo" ADD CONSTRAINT "coletes_do_grupo_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_cor_valida" CHECK ("teams"."cor" is null or "teams"."cor" ~ '^#[0-9a-f]{6}$');--> statement-breakpoint
UPDATE "teams" SET "cor" = case lower(trim("name"))
  when 'preto' then '#15181a'
  when 'branco' then '#e8edea'
  when 'verde' then '#16a868'
  when 'laranja' then '#f2740f'
  when 'azul' then '#2f6fe0'
  when 'vermelho' then '#d9342a'
  when 'amarelo' then '#f5c518'
end
WHERE "cor" IS NULL;
