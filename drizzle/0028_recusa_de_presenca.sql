-- Quem pos quem na lista, e quem tirou o proprio nome.
--
-- A 0026 fechou a ENTRADA: ninguem entra numa lista por decisao de outra pessoa,
-- e os tres caminhos (convite, pedido, link) tem cada um o seu decisor. O que
-- ficou descoberto foi a SAIDA e o que vem depois dela. Sobrou uma excecao viva
-- -- fut de grupo com os times sorteados, e o admin da plataforma em qualquer
-- fut --, e nela o organizador punha alguem na lista, a pessoa saia, e ele
-- repunha. `podeDefinirPresencaPor` devolvia true para `jaEstaNoFut`, e ter
-- linha `out` conta como estar no fut.
--
-- `confirmed_by_player_id` e a testemunha que nao existia: auto-confirmacao e
-- confirmacao por terceiro produziam linhas IDENTICAS em attendances, e o unico
-- rastro morava em `notifications` -- outra tabela, chave opaca, que a pessoa
-- apaga ao marcar como lida. E dela que sai o nome de quem confirmou no e-mail
-- de agenda, que passa a mudar de texto quando a presenca foi marcada por outro.
-- `set null` e nao `cascade`: apagar quem confirmou nao pode apagar a presenca
-- de quem foi confirmado, que carrega V/E/D e avaliacao.
--
-- `opted_out_at` desambigua o `out`, que colapsa tres historias -- "desisti",
-- "nunca respondi" e "o organizador me tirou". So a primeira carimba. E o
-- registro do consentimento retirado, entao vale contra TODO MUNDO, inclusive
-- contra o admin da plataforma, que passa por cima de qualquer outra regra de
-- fut. So a propria pessoa limpa, entrando por conta propria.
--
-- A outra metade da recusa nao mora aqui: recusar um convite continua sendo
-- `match_day_invitations.status = 'declined'`, e quem junta as duas fontes num
-- booleano so e `situacaoDoAlvo` (src/lib/presenca.ts). Nao virou linha em
-- attendances de proposito -- `condicaoJaJogouCom` e `jaJogaramJuntos` definem
-- "ja dividiu um fut" lendo esta tabela SEM filtrar status, entao recusar um
-- convite passaria a render vinculo de circulo, e vinculo e o que autoriza
-- convidar.
--
-- Tudo aditivo: nenhuma linha existente muda de valor. Nulo em ambas e o
-- historico, e e o valor certo -- ninguem foi posto por terceiro nem recusou
-- antes de existir como registrar isso.

ALTER TABLE "attendances" ADD COLUMN "confirmed_by_player_id" integer;--> statement-breakpoint
ALTER TABLE "attendances" ADD COLUMN "opted_out_at" timestamp;--> statement-breakpoint
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_confirmed_by_player_id_players_id_fk" FOREIGN KEY ("confirmed_by_player_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;