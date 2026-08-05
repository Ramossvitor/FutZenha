# ⚽ FutZenha

Site para organizar a pelada semanal do grupo: confirmação de presença, sorteio de times balanceado, resultados, artilharia e rankings.

**Modelo de uso:** sem login para os jogadores. Um ou dois admins gerenciam tudo pelo painel `/admin`; o resto do grupo acessa o link público para ver a agenda e confirmar presença (na base da confiança — é um grupo fechado de amigos).

## Stack

- [Next.js 16](https://nextjs.org) (App Router) + TypeScript + Tailwind CSS v4
- Postgres com [Drizzle ORM](https://orm.drizzle.team) (local via Docker; produção no [Neon](https://neon.tech) free tier)
- Auth do admin: senha única em env var + cookie assinado (HMAC) — sem provider externo
- Deploy: [Vercel](https://vercel.com) (plano Hobby)

## Rodando local

Pré-requisitos: Node 20+, Docker.

```bash
# 1. Banco local (Postgres na porta 5433)
docker compose up -d

# 2. Env vars
cp .env.example .env   # e edite ADMIN_PASSWORD / SESSION_SECRET

# 3. Dependências + migrations + dados de exemplo
npm install
npm run db:migrate
npm run seed

# 4. Dev server
npm run dev
```

Acesse http://localhost:3000 — o painel fica em `/admin` (senha = `ADMIN_PASSWORD` do `.env`).

## Scripts

| Script | O que faz |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Build de produção (roda type-check) |
| `npm test` | Testes (algoritmo de sorteio) |
| `npm run db:generate` | Gera migration a partir de `src/db/schema.ts` |
| `npm run db:migrate` | Aplica migrations no banco do `DATABASE_URL` |
| `npm run db:studio` | UI para inspecionar o banco |
| `npm run seed` | **Apaga tudo** e repopula com dados de exemplo |

## Fluxo de uma pelada

1. Admin cria a pelada em `/admin/peladas` (data, hora, local).
2. O link público (`/pelada/[id]`) vai no grupo do WhatsApp; cada um marca **Vou / Fora**.
3. No dia, o admin sorteia os times (balanceado por nota, goleiros separados) e ajusta manualmente se quiser.
4. Durante/depois, o admin lança os jogos, placares e gols.
5. **Encerrar pelada** trava tudo e faz os números contarem na artilharia, nos rankings e na presença.

Notas dos jogadores (1–10) só aparecem no admin — nunca nas páginas públicas.

## Deploy (R$ 0)

1. Crie um banco no [Neon](https://neon.tech) e copie a connection string.
2. Importe o repo na [Vercel](https://vercel.com) e configure as env vars: `DATABASE_URL`, `ADMIN_PASSWORD`, `SESSION_SECRET` (string longa aleatória) e `NEXT_PUBLIC_SITE_URL` (URL final do site).
3. Rode as migrations no banco de produção: `DATABASE_URL=<neon> npm run db:migrate` (localmente, apontando para o Neon).
4. Deploy. Não rode o seed em produção — cadastre os jogadores reais no `/admin/jogadores`.

## Modelo de dados (resumo)

`players` → `attendances` ← `match_days` → `teams` → `team_players`; `games` (time A × time B com placar) → `goals` (autor + quantidade). O placar digitado não precisa bater com a soma dos gols — cobre gol contra e gol sem autor lembrado. Estatísticas são derivadas por query (`src/lib/stats.ts`), contando só peladas encerradas.

## Roadmap (fase 2)

- Feed iCalendar (`/api/calendar.ics`) para assinar a agenda no Google/Apple Calendar
- Nota sugerida pelo histórico (aproveitamento + gols recentes) como apoio ao sorteio
- Convidados avulsos, "craque da noite", caixinha do grupo, streaks/badges
