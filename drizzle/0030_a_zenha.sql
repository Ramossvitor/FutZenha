-- A zenha: os tipos, e so eles.
--
-- Primeira das tres migrations da moeda. Esta cria os dois enums novos e
-- acrescenta os dois valores de notification_type; a 0031 traz as tabelas que
-- os usam, e a 0032 traz o multiplicador.
--
-- A separacao NAO e organizacao: `ALTER TYPE ... ADD VALUE` nao pode ser usado
-- na mesma transacao em que o valor e criado -- a licao da 0012, repetida pela
-- 0026 e pela 0029. Nenhuma statement deste arquivo usa os tipos que ele cria,
-- e por isso a 0031 pode gravar linha com eles sem esbarrar na regra.
--
-- Os dois valores de notification_type sao ACRESCIMO. Nenhum valor existente e
-- renomeado: ha linhas gravadas em producao apontando para eles, e o Postgres
-- nao remove valor de enum. O tsc cobra o outro lado -- o mapa ICONE de
-- /notificacoes e Record<TipoDeAviso, ...>, entao valor novo sem icone nao
-- compila.
--
-- `zenha_creditada` existe porque o credito NAO sai no encerramento do fut: sai
-- na liquidacao, um a dois dias depois, quando o placar trava e o prazo de
-- contestacao das notas vence. Quando ele acontece, o `fut_encerrado` ja foi
-- embora, entao nao havia aviso em que pegar carona.
--
-- `multiplicador_devolvido` e o unico evento do multiplicador com tipo proprio.
-- O CONSUMO vai no corpo do credito -- somar um aviso so para dizer "seu item
-- foi usado" seria uma vibracao a mais pelo mesmo fut. A devolucao contraria a
-- expectativa de quem armou, e nao tem irmao em que pegar carona.
CREATE TYPE "public"."zenha_motivo" AS ENUM('participacao', 'nota', 'mvp', 'streak', 'boas_vindas', 'compra');--> statement-breakpoint
CREATE TYPE "public"."zenha_slot" AS ENUM('badge', 'moldura', 'cor_do_nome', 'titulo');--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'zenha_creditada';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'multiplicador_devolvido';
