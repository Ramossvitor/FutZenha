-- O ledger do e-mail de agenda passa a contar ENVIOS, e nao linhas carimbadas.
--
-- A 0025 criou `attendances.agenda_email_sent_at` como ledger dos freios de
-- src/lib/freios-de-envio.ts. So que o carimbo e SOBRESCRITO: dez envios e um
-- envio deixam a linha identica. Como os dois tetos somavam linhas carimbadas,
-- o mesmo par (fut, jogador) valia 1 para sempre -- e o cancelamento, que e
-- isento da janela por par de proposito, repete nesse mesmo par. Resultado:
-- alternar "Vou"/"Fora" num fut so mandava um e-mail por ciclo, indefinidamente,
-- com TETO_AGENDA_POR_JOGADOR_DIA e TETO_AGENDA_DIA presos em 1. Era o vetor que
-- a propria 0025 veio fechar, passando por baixo do freio.
--
-- `agenda_emails_sent` e o contador que faltava. Zera (e nao soma) quando o
-- carimbo anterior ja saiu da janela de 24h -- ver `carimbarEnvio` em
-- src/lib/agenda-convite.ts --, e por isso nao precisa de GC: fora da janela
-- ninguem le o numero, e o envio seguinte o recicla. Default 0 para o que veio
-- antes dela, que e o certo: linha sem carimbo nunca gerou e-mail.
--
-- `attendances_jogador_idx` serve ao vinculo do fut avulso ("ja dividiu um fut
-- com"), em condicaoJaJogouCom (src/lib/elegiveis.ts) e jaJogaramJuntos
-- (src/lib/fut-entrada-db.ts). Os dois perguntam por player_id sozinho, e a
-- unique (match_day_id, player_id) comeca pela coluna errada para essa forma --
-- e estas consultas rodam em toda renderizacao de /fut/[id], em todo
-- setMyAttendance("in") e na varredura de vespera.
--
-- Tudo aditivo: nenhuma linha existente muda de valor.

ALTER TABLE "attendances" ADD COLUMN "agenda_emails_sent" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "attendances_jogador_idx" ON "attendances" USING btree ("player_id");
