-- O slug que vai na URL de /jogador e /grupo, no lugar do id serial.
--
-- O id na URL expunha a ordem de cadastro e deixava a plataforma enumerável:
-- varrer /jogador/1..N mapeava quem existe. A partir daqui a URL é derivada do
-- nome, e nenhum slug é puramente numérico — é isso que faz a URL antiga virar
-- 404 em vez de continuar servindo o perfil de alguém.
--
-- O que o drizzle-kit gerou era `ADD COLUMN ... NOT NULL`, que não roda em
-- tabela populada. Aqui vai em três tempos — coluna nula, backfill, trava —
-- porque a migration precisa se bastar: ela roda no build da Vercel
-- (src/db/migrate.ts), sem passo manual depois.
--
-- O backfill reimplementa em SQL o `slugBase` de src/lib/slug.ts: minúsculas,
-- acento removido, o que não é [a-z0-9._-] vira hífen, hífen repetido colapsa,
-- pontas aparadas, corte em 60. O corte vem ANTES da validação, na mesma ordem
-- do TS: as colunas `name` são text sem teto (só os forms atuais param em 60), e
-- um nome comprido pode só revelar depois do corte que ficou curto demais ou
-- puramente numérico. Nome que sobra vazio, curto demais ou só com dígitos ganha
-- o prefixo do domínio ('jogador' / 'grupo'). Homônimos — que em `groups` são
-- normais, já que `groups.name` não é unique — desempatam pelo id.

ALTER TABLE "players" ADD COLUMN "slug" text;--> statement-breakpoint

WITH bruto AS (
  SELECT id, NULLIF(trim(BOTH '-._' FROM left(trim(BOTH '-._' FROM
    regexp_replace(regexp_replace(
      lower(translate(name,
        'áàâãäåéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÅÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
        'aaaaaaeeeeiiiiooooouuuucnaaaaaaeeeeiiiiooooouuuucn')),
      '[^a-z0-9._-]+', '-', 'g'), '-{2,}', '-', 'g')), 60)), '') AS b
  FROM players
), cand AS (
  SELECT id, trim(BOTH '-._' FROM left(
    CASE WHEN b IS NULL OR length(b) < 2 OR b ~ '^[0-9]+$'
      THEN 'jogador' || CASE WHEN b IS NULL THEN '' ELSE '-' || b END
      ELSE b END, 60)) AS c
  FROM bruto
), num AS (
  SELECT id, c, row_number() OVER (PARTITION BY c ORDER BY id) AS rn FROM cand
)
UPDATE players p
SET slug = CASE WHEN n.rn = 1 THEN n.c
                ELSE left(n.c, 60 - length('-' || p.id)) || '-' || p.id END
FROM num n WHERE n.id = p.id;--> statement-breakpoint

-- Cinto de segurança. O desempate acima usa o id, que é único, então só sobra
-- colisão contra um nome que JÁ terminava naquele sufixo ("Fulano 7" contra o
-- segundo "Fulano", de id 7). O contador entra no sufixo para que cada volta
-- gere um valor novo — sem ele, reanexar o mesmo id repetiria o mesmo slug e o
-- laço não terminaria. O teto grita alto em vez de pendurar o build.
DO $$
DECLARE tentativa int := 0;
BEGIN
  WHILE EXISTS (SELECT 1 FROM players GROUP BY slug HAVING count(*) > 1) LOOP
    tentativa := tentativa + 1;
    IF tentativa > 10 THEN RAISE EXCEPTION 'slug de players: nao consegui desempatar'; END IF;
    UPDATE players p
    SET slug = left(p.slug, 60 - length('-' || p.id || '-' || tentativa))
               || '-' || p.id || '-' || tentativa
    WHERE p.id IN (
      SELECT id FROM (SELECT id, row_number() OVER (PARTITION BY slug ORDER BY id) rn
                      FROM players) d WHERE d.rn > 1);
  END LOOP;
END $$;--> statement-breakpoint

-- O espelho do `ehSlug` de src/lib/slug.ts: se o backfill deixou algum slug
-- fora da régua, o build para AQUI — gravado, um slug que a rota rejeita é um
-- perfil que dá 404 para sempre, sem sintoma no deploy.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM players WHERE slug !~ '^[a-z0-9._-]{2,60}$' OR slug ~ '^[0-9]+$') THEN
    RAISE EXCEPTION 'slug de players: backfill produziu slug fora da regra';
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE "players" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_slug_unique" UNIQUE("slug");--> statement-breakpoint

ALTER TABLE "groups" ADD COLUMN "slug" text;--> statement-breakpoint

WITH bruto AS (
  SELECT id, NULLIF(trim(BOTH '-._' FROM left(trim(BOTH '-._' FROM
    regexp_replace(regexp_replace(
      lower(translate(name,
        'áàâãäåéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÅÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
        'aaaaaaeeeeiiiiooooouuuucnaaaaaaeeeeiiiiooooouuuucn')),
      '[^a-z0-9._-]+', '-', 'g'), '-{2,}', '-', 'g')), 60)), '') AS b
  FROM groups
), cand AS (
  SELECT id, trim(BOTH '-._' FROM left(
    CASE WHEN b IS NULL OR length(b) < 2 OR b ~ '^[0-9]+$'
      THEN 'grupo' || CASE WHEN b IS NULL THEN '' ELSE '-' || b END
      ELSE b END, 60)) AS c
  FROM bruto
), num AS (
  SELECT id, c, row_number() OVER (PARTITION BY c ORDER BY id) AS rn FROM cand
)
UPDATE groups g
SET slug = CASE WHEN n.rn = 1 THEN n.c
                ELSE left(n.c, 60 - length('-' || g.id)) || '-' || g.id END
FROM num n WHERE n.id = g.id;--> statement-breakpoint

DO $$
DECLARE tentativa int := 0;
BEGIN
  WHILE EXISTS (SELECT 1 FROM groups GROUP BY slug HAVING count(*) > 1) LOOP
    tentativa := tentativa + 1;
    IF tentativa > 10 THEN RAISE EXCEPTION 'slug de groups: nao consegui desempatar'; END IF;
    UPDATE groups g
    SET slug = left(g.slug, 60 - length('-' || g.id || '-' || tentativa))
               || '-' || g.id || '-' || tentativa
    WHERE g.id IN (
      SELECT id FROM (SELECT id, row_number() OVER (PARTITION BY slug ORDER BY id) rn
                      FROM groups) d WHERE d.rn > 1);
  END LOOP;
END $$;--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM groups WHERE slug !~ '^[a-z0-9._-]{2,60}$' OR slug ~ '^[0-9]+$') THEN
    RAISE EXCEPTION 'slug de groups: backfill produziu slug fora da regra';
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE "groups" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_slug_unique" UNIQUE("slug");--> statement-breakpoint

-- Aviso já entregue aponta para /grupo/{id}, que a partir de agora é 404. O
-- href é reescrito para o slug em vez de morrer. (Nenhuma notificação aponta
-- para /jogador — não há o que reescrever lá.)
UPDATE notifications n
SET href = '/grupo/' || g.slug || substring(n.href from length('/grupo/' || g.id) + 1)
FROM groups g
WHERE n.href ~ ('^/grupo/' || g.id || '(/|\?|$)');
