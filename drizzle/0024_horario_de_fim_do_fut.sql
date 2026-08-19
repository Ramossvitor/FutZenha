-- Horário de término do fut. O evento de agenda assumia 2h fixas para todo
-- mundo; agora quem marca o fut declara o fim. Nulo = não declarado, e o evento
-- cai no DURACAO_PADRAO_MIN de src/lib/agenda.ts.
--
-- O CHECK é a trava contra abuso: o evento vai para a agenda de quem confirmou,
-- e quem administra o fut reescreve o bloco de todo mundo. Fim <= início é
-- virada de meia-noite (soma 24h); com teto de 6h não existe start/end que
-- descreva um dia inteiro ou vários dias. Os futs já existentes têm end_time
-- nulo e passam pelo check sem tocar em nada.
ALTER TABLE "match_days" ADD COLUMN "end_time" time;--> statement-breakpoint
ALTER TABLE "match_days" ADD COLUMN "calendar_pushes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "match_days" ADD COLUMN "calendar_pushes_since" timestamp;--> statement-breakpoint
ALTER TABLE "match_days" ADD CONSTRAINT "match_days_duracao_check" CHECK ("match_days"."end_time" is null or ("match_days"."start_time" is not null and (case when "match_days"."end_time" > "match_days"."start_time" then "match_days"."end_time" - "match_days"."start_time" else "match_days"."end_time" - "match_days"."start_time" + interval '24 hours' end) between interval '30 minutes' and interval '6 hours'));